"""Celery task for per-topic generation — the async worker side of
`POST /api/v1/trust/projects/{project_id}/topics/{topic_id}/generate`.

Mirrors `backend/src/generate/tasks.py`'s job machinery (an encrypted BYOK
envelope in Redis + a `job:{id}:status` row) so the SHARED `GET
/api/v1/jobs/{job_id}` resolves both whole-lesson and per-topic jobs
identically — the Redis key helpers (`_byok_redis_key`, `_job_status_redis_key`,
`_write_status`, `_shred_envelope`) are imported from there rather than
re-implemented, so the key strings stay byte-identical across both job kinds.

ADR-001 discipline holds exactly as it does for `run_generation`: the BYOK key
transits ONLY the encrypted per-job envelope, is decrypted, used for the one
provider call, then shredded (`del api_key` + envelope `DEL`) on every exit
path — success, provider failure, or an unexpected error. It is NEVER written
to the job status row, a log line, or a DB row.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import asyncpg
import redis.asyncio as redis
from wegofwd_llm.errors import LLMAuthError, LLMError, LLMRateLimitError, LLMSchemaError

from backend.config import settings
from backend.src.billing.vault import get_managed_key
from backend.src.core.byok_envelope import decrypt_api_key, parse_master_key
from backend.src.core.celery_app import celery_app
from backend.src.core.log_redaction import get_logger
from backend.src.generate.tasks import (
    _byok_redis_key,
    _job_status_redis_key,
    _shred_envelope,
    _write_status,
)

from . import project_repo, topic_repo
from .generate_topic import generate_topic_draft
from .toc_util import find_toc_topic

log = get_logger("trust.tasks")


def _redis_client() -> redis.Redis:
    """Factory for the task's own Redis connection.

    A Celery task argument list is JSON-serialized, so a live Redis client
    can't be passed in as an argument the way the BackgroundTasks path in
    `generate/tasks.py` does (it receives `redis_client` already-injected by
    the request handler). Kept as a separate, patchable function so tests can
    monkeypatch it to hand back a shared fakeredis instance — the same one the
    submit endpoint wrote the envelope/status into.
    """
    return redis.from_url(settings.redis_url, decode_responses=False)


async def _db_connect() -> asyncpg.Connection:
    """Factory for the task's own DB connection (the Celery worker has no
    FastAPI pool). A separate, patchable function — same reasoning as
    `_redis_client` — so DB-backed tests can substitute a connection that
    shares the test's own rollback-isolated transaction instead of opening a
    second real connection that can't see uncommitted seed data."""
    return await asyncpg.connect(settings.database_url)


async def _run(
    *,
    job_id: uuid.UUID,
    project_id: uuid.UUID,
    topic_id: str,
    provider_id: str,
    model: str | None,
    guidance: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """Do the actual generation work for one per-topic generate job.

    Never raises — every exit path (success, a known LLM failure, or an
    unexpected error) writes a status row and shreds the BYOK envelope.
    """
    r = _redis_client()
    api_key: str | None = None
    try:
        # (a) Idempotency — a redelivered/retried task (task_acks_late) must
        # not create a second topic_version for the same job.
        raw = await r.get(_job_status_redis_key(job_id))
        if raw is not None:
            try:
                already = json.loads(raw).get("status")
            except (json.JSONDecodeError, AttributeError):
                already = None
            if already == "done":
                return

        # (b) Resolve the provider key: managed = OUR vault key (ADR-005 D6),
        # BYOK = decrypt the per-job envelope.
        if managed:
            api_key = get_managed_key(provider_id)
            if not api_key:
                log.warning("managed_key_missing", job_id=str(job_id), provider=provider_id)
                await _write_status(r, job_id, "failed", error="managed generation unavailable")
                return
        else:
            envelope_blob = await r.get(_byok_redis_key(job_id))
            if envelope_blob is None:
                # TTL expired before the worker picked up the job.
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

        # (c) Load the topic's sources, generate, and persist the version.
        # A fresh asyncpg connection — the Celery worker has no FastAPI pool.
        conn = await _db_connect()
        try:
            p = await project_repo.get_project(conn, project_id=project_id)
            if p is None:
                await _write_status(r, job_id, "failed", error="project not found")
                return
            topic = find_toc_topic(p.toc, topic_id)
            if topic is None:
                await _write_status(r, job_id, "failed", error="topic not found")
                return

            topic_title = topic.get("title") or ""
            subtopics = [
                st.get("label") if isinstance(st, dict) else st for st in topic.get("subtopics", [])
            ]
            topic_source_ids = topic.get("source_ids") or []
            all_inputs = await project_repo.list_inputs(conn, project_id=project_id)
            inputs_by_id = {str(i.id): i for i in all_inputs}
            sources = [inputs_by_id[sid] for sid in topic_source_ids if sid in inputs_by_id]
            if not sources:
                await _write_status(r, job_id, "failed", error="no sources for this topic")
                return

            resolved_model = model or settings.anthropic_default_model
            await _write_status(
                r, job_id, "running"
            )  # phase: queued -> running (foreground progress)
            try:
                out = await asyncio.to_thread(
                    generate_topic_draft,
                    sources=sources,
                    topic_title=topic_title,
                    subtopics=subtopics,
                    audience=p.audience,
                    goal=p.goal,
                    provider_id=provider_id,
                    api_key=api_key,
                    model=resolved_model,
                )
            except LLMSchemaError:
                log.warning("topic_generation_failed", job_id=str(job_id), reason="schema")
                await _write_status(
                    r, job_id, "failed", error="generated topic draft failed validation"
                )
                return
            except LLMAuthError:
                log.warning("topic_generation_failed", job_id=str(job_id), reason="auth")
                await _write_status(
                    r,
                    job_id,
                    "failed",
                    error="The API key was rejected by the provider. Check it in Settings.",
                )
                return
            except LLMRateLimitError:
                log.warning("topic_generation_failed", job_id=str(job_id), reason="rate_limit")
                await _write_status(
                    r,
                    job_id,
                    "failed",
                    error="The provider is rate-limiting requests. Try again shortly.",
                )
                return
            except LLMError:
                log.warning("topic_generation_failed", job_id=str(job_id), reason="llm_error")
                await _write_status(r, job_id, "failed", error="topic generation failed")
                return
            except Exception:
                # Defense in depth: never let a raw error escape with key material.
                log.warning("topic_generation_failed", job_id=str(job_id), reason="unexpected")
                await _write_status(r, job_id, "failed", error="topic generation failed")
                return

            by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
            sections = [
                {
                    "heading": sec.heading,
                    "body": sec.body,
                    "source_ids": [by_label[label] for label in sec.sources if label in by_label],
                }
                for sec in out.sections
            ]
            v = await topic_repo.create_topic_version(
                conn,
                project_id=project_id,
                topic_id=topic_id,
                title=topic_title,
                source_ids=topic_source_ids,
                content={"sections": sections},
                created_by_sub=recorded_by_sub,
                generation_meta={
                    "kind": "topic_draft",
                    "model": resolved_model,
                    "provider_id": provider_id,
                    "source_input_ids": topic_source_ids,
                    **({"guidance": guidance} if guidance else {}),
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
                "version_id": str(v.id),
                "topic_id": v.topic_id,
                "version_no": v.version_no,
            },
        )
    except Exception:
        # Defense in depth: an unhandled error anywhere above (DB, Redis,
        # decrypt) must still land as a SAFE failed status — never the raw
        # exception, which could carry key material in its message.
        log.warning("trust_generate_topic_task_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="topic generation failed")
        except Exception:
            log.warning("status_write_failed", job_id=str(job_id))
    finally:
        # (e) SHRED — drop our reference to the key and delete the envelope on
        # every exit path, managed or BYOK (DEL on a missing key is a
        # harmless no-op, so this is safe even when there was never an
        # envelope to begin with).
        if api_key is not None:
            del api_key
        await _shred_envelope(r, job_id)
        await r.aclose()


@celery_app.task(bind=True, name="trust.generate_topic")
def generate_topic_task(
    self,
    *,
    job_id: str,
    project_id: str,
    topic_id: str,
    provider_id: str,
    model: str | None,
    guidance: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run(
            job_id=uuid.UUID(job_id),
            project_id=uuid.UUID(project_id),
            topic_id=topic_id,
            provider_id=provider_id,
            model=model,
            guidance=guidance,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )
