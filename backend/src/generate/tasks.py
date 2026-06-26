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
import dataclasses
import json
import uuid
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as redis
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.errors import LLMAuthError, LLMError, LLMRateLimitError, LLMSchemaError
from wegofwd_llm.registry import build_provider
from wegofwd_llm.trust import PolicyBlock, engine_trust

from backend.config import settings
from backend.src.core.byok_envelope import decrypt_api_key, parse_master_key
from backend.src.core.format_scan import lesson_warnings
from backend.src.core.log_redaction import get_logger
from backend.src.generate.anthropic_caller import parse_json_response
from backend.src.generate.lesson_schema import LessonOutput
from backend.src.generate.prompt_builder import build_lesson_prompt

log = get_logger("generate.tasks")

# Output-token budget. The default matches the provider's conservative ceiling;
# a page target raises it (~one page of rendered lesson ≈ 800 output tokens incl.
# JSON + markdown) up to the Sonnet 4.6 model maximum.
_DEFAULT_MAX_TOKENS = 16384
_MODEL_MAX_TOKENS = 64000
_TOKENS_PER_PAGE = 800

# Models are stochastic and occasionally return non-JSON or schema-invalid
# output. Instead of blind re-rolls, the conformance loop (generate_validated)
# feeds the validator's error back and asks for corrected JSON. Budget = 1
# initial call + _MAX_REPAIRS repairs (3 total). A targeted repair beats a blind
# re-roll per call, so 3 here is stronger than the old 6 blind attempts and
# cheaper on the author's BYOK bill. Transient provider errors (rate-limit /
# timeout) are not schema failures — they fail fast (see
# docs/multi-provider-wiring-phase2.md).
_MAX_REPAIRS = 2


def _max_tokens_for_pages(target_pages: int) -> int:
    """Pick the output-token ceiling for a lesson with a given page target.

    0 (no target) keeps the default. A target never lowers the ceiling below the
    default (so short targets don't risk truncating richly formatted output) and
    never exceeds the model maximum.
    """
    if target_pages <= 0:
        return _DEFAULT_MAX_TOKENS
    return max(_DEFAULT_MAX_TOKENS, min(target_pages * _TOKENS_PER_PAGE, _MODEL_MAX_TOKENS))


def _format_warnings(lesson: LessonOutput) -> list[dict[str, Any]]:
    """Gate 3 — non-fatal format-drift heuristics over the validated lesson.

    Schema validation (gate 1) guarantees structure but cannot see that a section
    titled "Balance Sheet" rendered no table, or a "Quadratic Formula" section
    carries no KaTeX. The warnings ride along on the job's status row (a
    review-queue / prompt-drift signal — see docs/QUALITY_GATES.md §1 gate 3,
    §2a) and NEVER fail the job: the content is already schema-valid.

    Delegates to the shared `core.format_scan` helper (same gate 3 the export
    book-scan uses), which adapts the lesson to the validator's tutorial shape.
    """
    try:
        return lesson_warnings(lesson.model_dump())
    except Exception:
        # Defensive: a non-LessonOutput (no model_dump) must still not raise —
        # gate 3 can't fail an already schema-valid generation.
        return []


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
    trust: dict[str, Any] | None = None,
    warnings: list[dict[str, Any]] | None = None,
    usage: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {"status": status}
    if error is not None:
        payload["error"] = error
    if result is not None:
        payload["result"] = result
    if trust is not None:
        payload["trust"] = trust
    if warnings:
        payload["warnings"] = warnings
    if usage is not None:
        payload["usage"] = usage
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
    provider_id: str = "anthropic",
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

    # ── 3. Generate via the provider seam: validate → repair (memo Phase 2a) ──
    # generate_validated runs the model, validates the response, and on a schema
    # failure feeds the validator's error back asking for corrected JSON (up to
    # _MAX_REPAIRS). Transient provider errors (auth / rate-limit / timeout)
    # raise an LLMError and fail fast — no outer retry. The api_key is used across
    # the loop then shredded in `finally` on every path, so the credential window
    # is the job's lifetime, not a single attempt.
    lesson: LessonOutput | None = None
    trust: dict | None = None  # ContentTrustManifest (ADR-015) for this unit
    usage: dict[str, Any] | None = None  # observed token counts (SBQ-USAGE-001)
    last_error = "generation failed"

    def _validate(text: str) -> LessonOutput:
        # Raises on bad JSON (parse_json_response) or bad schema (model_validate);
        # generate_validated treats either as invalid and repairs. Returns the
        # validated model on success.
        return LessonOutput.model_validate(parse_json_response(text))

    try:
        # All providers come from the registry factory: anthropic resolves to the
        # tool-use AnthropicNativeProvider (Phase 4 — reliable JSON via a forced
        # tool call), others to the OpenAI-compatible client. response_format="json"
        # drives tool-use for anthropic and json_object for the OpenAI providers.
        # Preserve the settings-based default model for anthropic (the registry
        # default is a fixed string).
        resolved_model = model
        if provider_id == "anthropic" and not resolved_model:
            resolved_model = settings.anthropic_default_model
        provider = build_provider(provider_id, api_key=api_key, model=resolved_model)
        req = LLMRequest(prompt=prompt, max_tokens=max_tokens, response_format="json")
        # Sync loop in a thread so we don't block the event loop.
        result = await asyncio.to_thread(
            generate_validated, provider, req, _validate, max_repairs=_MAX_REPAIRS
        )
        lesson = result.parsed
        # Stamp the Content Trust Manifest (ADR-015). The seam fills provenance +
        # validation from the resolved model (which may differ from what was
        # requested) and the conformance outcome; we attach the standing BYOK data
        # policy. compliance/integrity attach later, at export (SBQ-TRUST-002).
        # generated_at is stamped here at the worker: for a single-unit lesson the
        # worker is canonical (ADR-015 §8); a book compiled from many units prefers
        # the export timestamp.
        manifest = engine_trust(
            provider_id,
            provider.model,
            schema_validated=True,  # generate_validated returned ⇒ it validated
            repair_attempts=max(result.attempts - 1, 0),
            schema_id="lesson@1",
            generated_at=datetime.now(UTC).isoformat(),
        )
        manifest = dataclasses.replace(
            manifest,
            policy=PolicyBlock(byok=True, prompts_stored=False, key_stored=False),
        )
        trust = manifest.to_public_dict()
        # Observed token usage (SBQ-USAGE-001). The provider hands us exact counts
        # on every call; generate_validated sums them ACROSS repair attempts, so this
        # reflects real spend, not just the accepted lesson. Metadata only — no key,
        # no content (ADR-001 holds). The device attributes it to the requesting
        # book/topic in its local ledger; we persist nothing server-side here.
        usage = {
            "provider": provider_id,
            "model": provider.model,
            "input_tokens": result.total_input_tokens,
            "output_tokens": result.total_output_tokens,
            "tokens_estimated": result.response.tokens_estimated,
            "attempts": result.attempts,
        }
        if result.repaired:
            log.info("generation_repaired", job_id=str(job_id), attempts=result.attempts)
    except LLMSchemaError:
        last_error = "generated content failed validation"
        log.warning("generation_failed", job_id=str(job_id), reason="schema")
    except LLMAuthError:
        # The provider rejected the key (401/403). Actionable for the user — point
        # them at Settings. Message is key-free.
        last_error = (
            "Your API key was rejected by the provider. Check it in Settings — it may be "
            "invalid, revoked, or out of credit."
        )
        log.warning("generation_failed", job_id=str(job_id), reason="auth")
    except LLMRateLimitError:
        last_error = "The provider is rate-limiting requests. Wait a moment and try again."
        log.warning("generation_failed", job_id=str(job_id), reason="rate_limit")
    except LLMError:
        # Other LLM failure (timeout / transport / unexpected status). Fail fast.
        last_error = "generation failed"
        log.warning("generation_failed", job_id=str(job_id), reason="llm_error")
    except Exception:
        # Defense in depth: never let a raw exception escape the worker — it could
        # reach the framework logger with key material. Log type only, no message.
        last_error = "generation failed"
        log.warning("generation_failed", job_id=str(job_id), reason="unexpected")
    finally:
        # SHRED: drop our key reference and the encrypted envelope as soon as
        # we're done with the user's credentials, on every path. (CPython str
        # immutability prevents true zeroing, but del + envelope DEL close the
        # window.)
        del api_key
        await _shred_envelope(redis_client, job_id)

    # ── 4. Write outcome ──────────────────────────────────────────────────────
    if lesson is None:
        await _write_status(redis_client, job_id, "failed", error=last_error)
        return

    # Gate 3: non-fatal format-drift heuristics. Warnings attach to the status row
    # (review-queue signal) and never change the done/failed outcome. The per-
    # provider warning rate is the multi-provider consistency metric (QUALITY_GATES
    # §2a), so the structured log carries the provider for aggregation.
    format_warnings = _format_warnings(lesson)
    if format_warnings:
        log.warning(
            "format_warnings",
            job_id=str(job_id),
            provider=provider_id,
            count=len(format_warnings),
            rules=sorted({w["rule"] for w in format_warnings}),
        )

    await _write_status(
        redis_client,
        job_id,
        "done",
        result=lesson.model_dump(),
        trust=trust,
        warnings=format_warnings,
        usage=usage,
    )
    log.info("generation_done", job_id=str(job_id))
