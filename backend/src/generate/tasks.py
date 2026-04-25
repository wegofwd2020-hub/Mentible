"""Background generation task — the worker side of /generate.

Runs as a FastAPI BackgroundTask in MVP. Migration to Celery for v1.1 is
straightforward (the function shape stays the same; only the dispatcher
changes). Per MVP_v1.md "What's intentionally fragile in MVP", this MVP
intentionally trades durability for simpler infra: a process restart loses
in-flight jobs and the user re-submits.

End-to-end shape:
    1. Read encrypted envelope from Redis (byok:{job_id}).
    2. Derive per-job key, decrypt → plaintext api_key.
    3. Build self-learner lesson prompt.
    4. Call Anthropic via the caller wrapper (key passes through, never logged).
    5. Parse + schema-validate the response.
    6. Write status="done" + result to Redis (job:{job_id}:status).
    7. SHRED: DEL byok:{job_id} so the encrypted envelope is gone immediately.

On any failure, write status="failed" with a SAFE error message (no traceback,
no key fragments, no Anthropic SDK strings).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import redis.asyncio as redis
from pydantic import ValidationError

from backend.config import settings
from backend.src.core.byok_envelope import decrypt_api_key, parse_master_key
from backend.src.core.log_redaction import get_logger
from backend.src.generate.anthropic_caller import (
    AnthropicCallError,
    call_anthropic,
    parse_json_response,
)
from backend.src.generate.lesson_schema import LessonOutput
from backend.src.generate.prompt_builder import build_lesson_prompt

log = get_logger("generate.tasks")


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
    """Delete the encrypted-key envelope from Redis as soon as the worker is done.

    Defence in depth — even though TTL would expire it within 120 s, an explicit
    DEL on the success+failure paths means the encrypted blob is gone the moment
    it's no longer needed.
    """
    try:
        await r.delete(_byok_redis_key(job_id))
    except Exception:
        # Last-ditch — failure to delete is not fatal (TTL handles it) but log it
        log.warning("envelope_shred_failed", job_id=str(job_id))


async def run_generation(
    *,
    job_id: uuid.UUID,
    topic: str,
    level: str,
    language: str,
    format: str,
    depth: str = "standard",
    prior_knowledge: str | None = None,
    framing: str | None = None,
    model: str | None = None,
    redis_client: redis.Redis,
) -> None:
    """Execute the full generation pipeline for one job.

    Never raises — all failures land in the job status row.
    """
    log.info("generation_started", job_id=str(job_id), topic_len=len(topic), format=format)

    # Mark running
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
        # TTL expired before worker picked up the job, or job_id was tampered.
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
    if format != "lesson":
        # PR-2 is lesson-only. Quiz/Explanation are PR-3+ deliverables.
        await _write_status(
            redis_client,
            job_id,
            "failed",
            error=f"format '{format}' not yet supported in this MVP",
        )
        await _shred_envelope(redis_client, job_id)
        return

    prompt = build_lesson_prompt(
        topic=topic,
        level=level,
        language=language,
        depth=depth,
        prior_knowledge=prior_knowledge,
        framing=framing,
    )

    # ── 3. Call Anthropic + parse + validate ─────────────────────────────────
    chosen_model = model or settings.anthropic_default_model
    try:
        # Run synchronous SDK call in a thread so we don't block the event loop.
        raw_text = await asyncio.to_thread(
            call_anthropic,
            api_key=api_key,
            prompt=prompt,
            model=chosen_model,
        )
        # SHRED: api_key has been used, drop our reference. (CPython str
        # immutability prevents true zeroing, but explicit del + envelope
        # deletion below close the window.)
        del api_key
    except AnthropicCallError:
        await _write_status(
            redis_client, job_id, "failed", error="generation failed (Anthropic call error)"
        )
        await _shred_envelope(redis_client, job_id)
        return
    except Exception:
        # Unknown failure — log type only, never the message.
        log.warning("generation_unknown_error", job_id=str(job_id))
        await _write_status(redis_client, job_id, "failed", error="generation failed")
        await _shred_envelope(redis_client, job_id)
        return

    # The api_key is no longer needed. Shred the encrypted envelope NOW —
    # we're done with everything related to the user's credentials.
    await _shred_envelope(redis_client, job_id)

    # ── 4. JSON parse + schema validate ──────────────────────────────────────
    try:
        parsed = parse_json_response(raw_text)
    except AnthropicCallError as exc:
        await _write_status(redis_client, job_id, "failed", error=str(exc))
        return

    try:
        lesson = LessonOutput.model_validate(parsed)
    except ValidationError:
        log.warning("lesson_schema_validation_failed", job_id=str(job_id))
        await _write_status(
            redis_client, job_id, "failed", error="generated content failed schema validation"
        )
        return

    # ── 5. Write success ─────────────────────────────────────────────────────
    await _write_status(
        redis_client,
        job_id,
        "done",
        result=lesson.model_dump(),
    )
    log.info("generation_done", job_id=str(job_id))
