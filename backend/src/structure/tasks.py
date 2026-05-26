"""Background task for POST /structure — the worker side of TOC structuring.

Same shape as generate/tasks.run_generation (FastAPI BackgroundTask in MVP,
Celery-ready later), same BYOK discipline (ADR-001):

    1. Read encrypted envelope from Redis (byok:{job_id}).
    2. Derive per-job key, decrypt → plaintext api_key.
    3. Build the structuring prompt from the free-text TOC.
    4. Call Anthropic via the key-safe caller wrapper (never logged).
    5. Parse + validate into a StructuredTOC. Retry up to 3× on malformed JSON
       (per CLAUDE.md pipeline rule + PORT_BRIEF carry-over gotcha).
    6. Write status="done" + the structured tree to Redis.
    7. SHRED: DEL byok:{job_id}.

On any failure, write status="failed" with a SAFE error message (no traceback,
no key fragments, no Anthropic SDK strings, no raw LLM response body).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import redis.asyncio as redis
from pipeline.toc_structurer import StructureError, parse_structured_toc

from backend.config import settings
from backend.src.core.byok_envelope import decrypt_api_key, parse_master_key
from backend.src.core.log_redaction import get_logger
from backend.src.generate.anthropic_caller import AnthropicCallError, call_anthropic
from backend.src.structure.prompt_builder import build_structure_prompt

log = get_logger("structure.tasks")

# Max attempts at getting parseable, schema-valid JSON out of the model.
# Each retry is another Anthropic call (another charge on the user's BYOK key),
# so it is capped — see CLAUDE.md pipeline rules ("retry up to 3× on ValidationError").
_MAX_STRUCTURE_ATTEMPTS = 3


def _byok_redis_key(job_id: uuid.UUID) -> str:
    return f"byok:{job_id}"


def _job_status_redis_key(job_id: uuid.UUID) -> str:
    return f"job:{job_id}:status"


async def _write_status(
    r: redis.Redis,
    job_id: uuid.UUID,
    status: str,
    *,
    error: str | None = None,
    result: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {"status": status}
    if error is not None:
        payload["error"] = error
    if result is not None:
        payload["result"] = result
    await r.setex(
        _job_status_redis_key(job_id),
        settings.byok_redis_ttl_seconds * 10,  # status row outlives the envelope
        json.dumps(payload),
    )


async def _shred_envelope(r: redis.Redis, job_id: uuid.UUID) -> None:
    """Delete the encrypted-key envelope as soon as the worker is done (defence
    in depth; TTL would expire it anyway)."""
    try:
        await r.delete(_byok_redis_key(job_id))
    except Exception:
        log.warning("envelope_shred_failed", job_id=str(job_id))


async def run_structure(
    *,
    job_id: uuid.UUID,
    raw_toc: str,
    grade: int | None,
    model: str | None,
    redis_client: redis.Redis,
) -> None:
    """Execute the full structuring pipeline for one job. Never raises — all
    failures land in the job status row."""
    log.info("structure_started", job_id=str(job_id), toc_len=len(raw_toc))

    try:
        await _write_status(redis_client, job_id, "running")
    except Exception:
        log.warning("status_write_failed_at_start", job_id=str(job_id))

    # ── 1. Fetch + decrypt envelope ──────────────────────────────────────────
    try:
        envelope_blob: bytes | None = await redis_client.get(_byok_redis_key(job_id))
    except Exception:
        log.warning("envelope_fetch_failed", job_id=str(job_id))
        await _write_status(redis_client, job_id, "failed", error="internal error")
        return

    if envelope_blob is None:
        log.warning("envelope_missing", job_id=str(job_id))
        await _write_status(redis_client, job_id, "failed", error="job timed out")
        return

    try:
        master_key = parse_master_key(settings.byok_master_key)
        api_key = decrypt_api_key(master_key, str(job_id), envelope_blob)
    except Exception:
        log.warning("envelope_decrypt_failed", job_id=str(job_id))
        await _write_status(redis_client, job_id, "failed", error="internal error")
        await _shred_envelope(redis_client, job_id)
        return

    # ── 2. Build prompt ──────────────────────────────────────────────────────
    prompt = build_structure_prompt(raw_toc=raw_toc, grade=grade)
    chosen_model = model or settings.anthropic_default_model

    # ── 3. Call + parse, with bounded retry on malformed JSON ────────────────
    structured = None
    try:
        for attempt in range(1, _MAX_STRUCTURE_ATTEMPTS + 1):
            try:
                raw_text = await asyncio.to_thread(
                    call_anthropic,
                    api_key=api_key,
                    prompt=prompt,
                    model=chosen_model,
                )
            except AnthropicCallError:
                # A transport/SDK failure is not a "bad JSON" case — don't burn
                # the user's key on retries; fail fast.
                await _write_status(
                    redis_client,
                    job_id,
                    "failed",
                    error="structuring failed (Anthropic call error)",
                )
                return
            except Exception:
                log.warning("structure_unknown_error", job_id=str(job_id))
                await _write_status(redis_client, job_id, "failed", error="structuring failed")
                return

            try:
                structured = parse_structured_toc(raw_text)
                break
            except StructureError as exc:
                log.warning(
                    "structure_parse_failed",
                    job_id=str(job_id),
                    attempt=attempt,
                    reason=str(exc),  # safe: never contains the response body or key
                )
                if attempt == _MAX_STRUCTURE_ATTEMPTS:
                    await _write_status(
                        redis_client,
                        job_id,
                        "failed",
                        error="could not structure the table of contents — try rephrasing it",
                    )
                    return
    finally:
        # The api_key is no longer needed regardless of outcome. Drop our
        # reference and shred the envelope. (CPython str immutability prevents
        # true zeroing; explicit del + DEL close the window.)
        del api_key
        await _shred_envelope(redis_client, job_id)

    # ── 4. Write success ─────────────────────────────────────────────────────
    assert structured is not None  # the retry loop either set it or returned
    await _write_status(redis_client, job_id, "done", result=structured.model_dump())
    log.info("structure_done", job_id=str(job_id))
