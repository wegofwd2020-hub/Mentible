"""Celery task for audio -> transcript (Tamil STT capture, slice 1).

Mirrors trust/tasks.py::_run_version's job machinery (encrypted BYOK envelope in
Redis + a job:{id}:status blob, resolved by the shared GET /api/v1/jobs/{id})
but calls the portable STT seam (backend.src.capture) instead of the LLM and
persists an artifact_version whose content is the transcript segments.

ADR-001 discipline holds exactly as in _run_version: the BYOK key transits ONLY
the encrypted per-job envelope, is decrypted, used for the one STT call, then
shredded on every exit path. It is NEVER written to the status row, a log line,
or a DB row.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import asyncpg
import redis.asyncio as redis

from backend.config import settings
from backend.src.billing.vault import get_managed_stt_key
from backend.src.capture import transcribe as capture_transcribe
from backend.src.capture.errors import STTAuthError, STTError, STTRateLimitError
from backend.src.capture.registry import STT_REGISTRY
from backend.src.core.byok_envelope import decrypt_api_key, parse_master_key
from backend.src.core.celery_app import celery_app
from backend.src.core.log_redaction import get_logger
from backend.src.generate.tasks import (
    _byok_redis_key,
    _job_status_redis_key,
    _shred_envelope,
    _write_status,
)

from . import artifact_repo

log = get_logger("trust.transcribe")


def _redis_client() -> redis.Redis:
    return redis.from_url(settings.redis_url, decode_responses=False)


async def _db_connect() -> asyncpg.Connection:
    return await asyncpg.connect(settings.database_url)


async def _run_transcribe(
    *,
    job_id: uuid.UUID,
    artifact_id: uuid.UUID,
    input_id: uuid.UUID,
    audio_path: str,
    language: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """Never raises — every exit path writes a status row and shreds the envelope."""
    r = _redis_client()
    api_key: str | None = None
    try:
        # (a) Idempotency — a redelivered task must not create a second version.
        raw = await r.get(_job_status_redis_key(job_id))
        if raw is not None:
            try:
                already = json.loads(raw).get("status")
            except (json.JSONDecodeError, AttributeError):
                already = None
            if already == "done":
                return

        # (b) Resolve the provider key: managed = OUR vault key, BYOK = decrypt.
        if managed:
            api_key = get_managed_stt_key(provider_id)
            if not api_key:
                log.warning("managed_key_missing", job_id=str(job_id), provider=provider_id)
                await _write_status(r, job_id, "failed", error="managed transcription unavailable")
                return
        else:
            envelope_blob = await r.get(_byok_redis_key(job_id))
            if envelope_blob is None:
                log.warning("envelope_missing", job_id=str(job_id))
                await _write_status(r, job_id, "failed", error="job timed out")
                return
            try:
                master_key = parse_master_key(settings.byok_master_key)
                api_key = decrypt_api_key(master_key, str(job_id), envelope_blob)
            except Exception:
                log.warning("envelope_decrypt_failed", job_id=str(job_id))
                await _write_status(r, job_id, "failed", error="internal error")
                return

        # (c) Transcribe + persist version 1.
        await _write_status(r, job_id, "running")
        try:
            segments = await capture_transcribe(
                provider_id=provider_id,
                api_key=api_key,
                audio_path=audio_path,
                language=language,
                model=model,
            )
        except STTAuthError:
            log.warning("transcription_failed", job_id=str(job_id), reason="auth")
            await _write_status(
                r,
                job_id,
                "failed",
                error="The API key was rejected by the provider. Check it in Settings.",
            )
            return
        except STTRateLimitError:
            log.warning("transcription_failed", job_id=str(job_id), reason="rate_limit")
            await _write_status(
                r,
                job_id,
                "failed",
                error="The provider is rate-limiting requests. Try again shortly.",
            )
            return
        except (STTError, OSError):
            log.warning("transcription_failed", job_id=str(job_id), reason="stt_error")
            await _write_status(r, job_id, "failed", error="transcription failed")
            return
        except Exception:
            # Defense in depth: never let a raw error escape with key material.
            log.warning("transcription_failed", job_id=str(job_id), reason="unexpected")
            await _write_status(r, job_id, "failed", error="transcription failed")
            return

        # Record the EFFECTIVE model that actually ran (the request `model` is
        # None on the managed default path) — so the transcript's provenance says
        # which engine produced it, not just null.
        spec = STT_REGISTRY.get(provider_id)
        effective_model = model or (spec.default_model if spec else None)

        content = {
            "language": language,
            "segments": [
                {
                    "text": s.text,
                    "start": s.start,
                    "end": s.end,
                    "confidence": s.confidence,
                    "speaker": None,  # manual tagging happens in the review surface (slice 3)
                }
                for s in segments
            ],
            "source_audio_ref": str(input_id),
            "stt_meta": {"provider": provider_id, "model": effective_model},
        }

        conn = await _db_connect()
        try:
            v = await artifact_repo.create_version(
                conn,
                artifact_id=artifact_id,
                content=content,
                created_by_sub=recorded_by_sub,
                generation_meta={
                    "kind": "transcription",
                    "provider_id": provider_id,
                    "model": effective_model,
                    "source_input_id": str(input_id),
                },
            )
        finally:
            await conn.close()

        # (d) Success.
        await _write_status(
            r,
            job_id,
            "done",
            result={
                "artifact_id": str(artifact_id),
                "version_id": str(v.id),
                "version_no": v.version_no,
            },
        )
    except Exception:
        log.warning("trust_transcribe_task_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="transcription failed")
        except Exception:
            log.warning("status_write_failed", job_id=str(job_id))
    finally:
        # (e) SHRED on every exit path.
        if api_key is not None:
            del api_key
        await _shred_envelope(r, job_id)
        await r.aclose()


@celery_app.task(bind=True, name="trust.transcribe")
def transcribe_task(
    self,
    *,
    job_id: str,
    artifact_id: str,
    input_id: str,
    audio_path: str,
    language: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run_transcribe(
            job_id=uuid.UUID(job_id),
            artifact_id=uuid.UUID(artifact_id),
            input_id=uuid.UUID(input_id),
            audio_path=audio_path,
            language=language,
            provider_id=provider_id,
            model=model,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )
