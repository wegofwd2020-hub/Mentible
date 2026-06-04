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

# Output-token budget. The default matches the provider's conservative ceiling;
# a page target raises it (~one page of rendered lesson ≈ 800 output tokens incl.
# JSON + markdown) up to the Sonnet 4.6 model maximum.
_DEFAULT_MAX_TOKENS = 16384
_MODEL_MAX_TOKENS = 64000
_TOKENS_PER_PAGE = 800

# Claude is stochastic and occasionally returns non-JSON or schema-invalid
# output; CLAUDE.md mandates retrying before failing the job. Each attempt is a
# fresh call with the same prompt (a re-roll usually parses cleanly).
# Raised 3 → 6: chapters whose enhancementInstructions embed a verbatim Mermaid
# block (many quotes/backticks the model must JSON-escape) push up the per-call
# invalid-JSON rate, so a few chapters were exhausting a 3-attempt budget. Extra
# re-rolls only cost tokens on the chapters that actually need them (success
# breaks the loop early).
_MAX_GENERATION_ATTEMPTS = 6


def _max_tokens_for_pages(target_pages: int) -> int:
    """Pick the output-token ceiling for a lesson with a given page target.

    0 (no target) keeps the default. A target never lowers the ceiling below the
    default (so short targets don't risk truncating richly formatted output) and
    never exceeds the model maximum.
    """
    if target_pages <= 0:
        return _DEFAULT_MAX_TOKENS
    return max(_DEFAULT_MAX_TOKENS, min(target_pages * _TOKENS_PER_PAGE, _MODEL_MAX_TOKENS))


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
    target_pages: int = 0,
    diagram_register: str = "balanced",
    prior_knowledge: str | None = None,
    framing: str | None = None,
    instructions: str | None = None,
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
        target_pages=target_pages,
        diagram_register=diagram_register,
        prior_knowledge=prior_knowledge,
        framing=framing,
        instructions=instructions,
    )
    max_tokens = _max_tokens_for_pages(target_pages)

    # ── 3. Call Anthropic + parse + validate, retrying transient bad output ───
    # The api_key is reused across attempts (each one needs it), then shredded
    # once in `finally` — regardless of outcome — so the credential window is
    # the job's lifetime, not a single attempt.
    chosen_model = model or settings.anthropic_default_model
    lesson: LessonOutput | None = None
    last_error = "generation failed"
    try:
        for attempt in range(1, _MAX_GENERATION_ATTEMPTS + 1):
            try:
                # Sync SDK call in a thread so we don't block the event loop.
                raw_text = await asyncio.to_thread(
                    call_anthropic,
                    api_key=api_key,
                    prompt=prompt,
                    model=chosen_model,
                    max_tokens=max_tokens,
                )
            except AnthropicCallError:
                last_error = "generation failed (Anthropic call error)"
                log.warning(
                    "generation_attempt_failed",
                    job_id=str(job_id),
                    attempt=attempt,
                    reason="call_error",
                )
                continue
            except Exception:
                # Unknown failure — log type only, never the message.
                last_error = "generation failed"
                log.warning("generation_unknown_error", job_id=str(job_id), attempt=attempt)
                continue

            try:
                parsed = parse_json_response(raw_text)
                lesson = LessonOutput.model_validate(parsed)
                break  # success — stop retrying
            except AnthropicCallError:
                last_error = "Anthropic returned invalid JSON"
                log.warning(
                    "generation_attempt_failed",
                    job_id=str(job_id),
                    attempt=attempt,
                    reason="invalid_json",
                )
                continue
            except ValidationError:
                last_error = "generated content failed schema validation"
                log.warning(
                    "generation_attempt_failed",
                    job_id=str(job_id),
                    attempt=attempt,
                    reason="schema",
                )
                continue
    finally:
        # SHRED: drop our key reference and the encrypted envelope as soon as
        # we're done with the user's credentials, on every path. (CPython str
        # immutability prevents true zeroing, but del + envelope DEL close the
        # window.)
        del api_key
        await _shred_envelope(redis_client, job_id)

    # ── 4. Write outcome ──────────────────────────────────────────────────────
    if lesson is None:
        log.warning("generation_failed", job_id=str(job_id), attempts=_MAX_GENERATION_ATTEMPTS)
        await _write_status(redis_client, job_id, "failed", error=last_error)
        return

    await _write_status(
        redis_client,
        job_id,
        "done",
        result=lesson.model_dump(),
    )
    log.info("generation_done", job_id=str(job_id))
