"""Celery tasks for per-topic generation and suggest-TOC — the async worker
side of `POST .../topics/{topic_id}/generate` (Phase A) and
`POST .../projects/{project_id}/suggest-toc` (Phase B, T1).

Mirrors `backend/src/generate/tasks.py`'s job machinery (an encrypted BYOK
envelope in Redis + a `job:{id}:status` row) so the SHARED `GET
/api/v1/jobs/{job_id}` resolves whole-lesson, per-topic, and suggest-TOC jobs
identically — the Redis key helpers (`_byok_redis_key`, `_job_status_redis_key`,
`_write_status`, `_shred_envelope`) are imported from there rather than
re-implemented, so the key strings stay byte-identical across all job kinds.
Suggest-TOC persists nothing to the DB — its job `result` carries the
suggested TOC dict directly.

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
from backend.src.accounts import repo as accounts_repo
from backend.src.auth.principal import Principal
from backend.src.billing import pricing, usage_repo
from backend.src.billing.access import over_cap, resolve_managed_access
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

from . import artifact_repo, book_gen, generation_job_repo, project_repo, topic_repo
from .access import project_id_for_artifact
from .generate import draft_output_to_sections, generate_draft
from .generate_topic import generate_topic_draft
from .toc_suggest import suggest_toc, toc_output_to_view
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


async def _record_trust_usage(
    conn: asyncpg.Connection,
    *,
    account_id: uuid.UUID,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    job_id: uuid.UUID,
) -> None:
    """Best-effort managed metering for a trust generation (ADR-005 D6).

    Mirrors `generate.tasks._record_managed_usage`, but takes the trust task's own
    live `conn` (the trust tasks open their own asyncpg connection rather than
    acquiring from a pool). Counts/cost only — no key, no content. Metering must
    NEVER fail the generation — any error is swallowed with a safe warning (the
    version is already persisted; under-counting is a known, logged gap).
    """
    try:
        cost = pricing.cost_micros(provider, model, input_tokens, output_tokens)
        await usage_repo.record_usage(
            conn,
            account_id=account_id,
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_micros=cost,
            job_id=job_id,
        )
        log.info("trust_managed_usage_recorded", job_id=str(job_id), cost_micros=cost)
    except Exception:
        # Counts/cost only — no key, no content — so a warning is safe, and metering
        # is never allowed to fail a generation whose content is already persisted.
        log.warning("trust_managed_usage_record_failed", job_id=str(job_id))


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
                for sec in out.parsed.sections
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

            # Meter managed spend server-side (ADR-005 D6) — best-effort, after a
            # successful generation + persist. BYOK jobs record nothing. The outer
            # try/except is belt-and-suspenders so even `get_or_create_account`
            # can't fail the job.
            if managed:
                try:
                    acct = await accounts_repo.get_or_create_account(
                        conn, idp_sub=recorded_by_sub, email=None
                    )
                    await _record_trust_usage(
                        conn,
                        account_id=acct.id,
                        provider=provider_id,
                        model=resolved_model,
                        input_tokens=out.total_input_tokens,
                        output_tokens=out.total_output_tokens,
                        job_id=job_id,
                    )
                except Exception:
                    log.warning("trust_managed_usage_record_failed", job_id=str(job_id))
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


async def _run_version(
    *,
    job_id: uuid.UUID,
    artifact_id: uuid.UUID,
    provider_id: str,
    model: str | None,
    guidance: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """Do the actual generation work for one whole-book draft generate job.

    Mirrors `_run`'s exact shape (idempotency check, key resolution, the
    `running` write, shred-on-every-exit-path) — deltas are: the aggregate
    is an artifact (not a topic within a project's toc), so `project_id` is
    resolved via `project_id_for_artifact`, and the persisted row is an
    `artifact_version` (via `artifact_repo.create_version`) rather than a
    `topic_version`. Never raises — every exit path (success, a known LLM
    failure, or an unexpected error) writes a status row and shreds the BYOK
    envelope.
    """
    r = _redis_client()
    api_key: str | None = None
    try:
        # (a) Idempotency — a redelivered/retried task (task_acks_late) must
        # not create a second artifact_version for the same job.
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

        # (c) Load the artifact's project + sources, generate, and persist
        # the version. A fresh asyncpg connection — the Celery worker has no
        # FastAPI pool.
        conn = await _db_connect()
        try:
            project_id = await project_id_for_artifact(conn, artifact_id=artifact_id)
            if project_id is None:
                await _write_status(r, job_id, "failed", error="artifact not found")
                return
            fmt = await conn.fetchval("SELECT format FROM artifact WHERE id=$1", artifact_id)
            p = await project_repo.get_project(conn, project_id=project_id)
            if p is None:
                await _write_status(r, job_id, "failed", error="project not found")
                return
            sources = await project_repo.list_inputs(conn, project_id=project_id)
            if not sources:
                await _write_status(
                    r, job_id, "failed", error="add at least one source before generating a draft"
                )
                return

            resolved_model = model or settings.anthropic_default_model
            await _write_status(
                r, job_id, "running"
            )  # phase: queued -> running (foreground progress)
            try:
                out = await asyncio.to_thread(
                    generate_draft,
                    sources=sources,
                    artifact_format=fmt,
                    topic=p.topic,
                    audience=p.audience,
                    goal=p.goal,
                    provider_id=provider_id,
                    api_key=api_key,
                    model=resolved_model,
                    guidance=guidance,
                )
            except LLMSchemaError:
                log.warning("draft_generation_failed", job_id=str(job_id), reason="schema")
                await _write_status(r, job_id, "failed", error="generated draft failed validation")
                return
            except LLMAuthError:
                log.warning("draft_generation_failed", job_id=str(job_id), reason="auth")
                await _write_status(
                    r,
                    job_id,
                    "failed",
                    error="The API key was rejected by the provider. Check it in Settings.",
                )
                return
            except LLMRateLimitError:
                log.warning("draft_generation_failed", job_id=str(job_id), reason="rate_limit")
                await _write_status(
                    r,
                    job_id,
                    "failed",
                    error="The provider is rate-limiting requests. Try again shortly.",
                )
                return
            except LLMError:
                log.warning("draft_generation_failed", job_id=str(job_id), reason="llm_error")
                await _write_status(r, job_id, "failed", error="draft generation failed")
                return
            except Exception:
                # Defense in depth: never let a raw error escape with key material.
                log.warning("draft_generation_failed", job_id=str(job_id), reason="unexpected")
                await _write_status(r, job_id, "failed", error="draft generation failed")
                return

            sections, cited = draft_output_to_sections(out.parsed, sources)
            v = await artifact_repo.create_version(
                conn,
                artifact_id=artifact_id,
                content={"sections": sections},
                created_by_sub=recorded_by_sub,
                generation_meta={
                    "kind": "draft",
                    "model": resolved_model,
                    "provider_id": provider_id,
                    "source_input_ids": cited,
                    **({"guidance": guidance} if guidance else {}),
                },
            )

            # Meter managed spend server-side (ADR-005 D6) — best-effort, after a
            # successful generation + persist. BYOK jobs record nothing. The outer
            # try/except is belt-and-suspenders so even `get_or_create_account`
            # can't fail the job.
            if managed:
                try:
                    acct = await accounts_repo.get_or_create_account(
                        conn, idp_sub=recorded_by_sub, email=None
                    )
                    await _record_trust_usage(
                        conn,
                        account_id=acct.id,
                        provider=provider_id,
                        model=resolved_model,
                        input_tokens=out.total_input_tokens,
                        output_tokens=out.total_output_tokens,
                        job_id=job_id,
                    )
                except Exception:
                    log.warning("trust_managed_usage_record_failed", job_id=str(job_id))
        finally:
            await conn.close()

        # (d) Success.
        await _write_status(
            r,
            job_id,
            "done",
            result={
                "version_id": str(v.id),
                "artifact_id": str(v.artifact_id),
                "version_no": v.version_no,
            },
        )
    except Exception:
        # Defense in depth: an unhandled error anywhere above (DB, Redis,
        # decrypt) must still land as a SAFE failed status — never the raw
        # exception, which could carry key material in its message.
        log.warning("trust_generate_version_task_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="draft generation failed")
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


@celery_app.task(bind=True, name="trust.generate_version")
def generate_version_task(
    self,
    *,
    job_id: str,
    artifact_id: str,
    provider_id: str,
    model: str | None,
    guidance: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run_version(
            job_id=uuid.UUID(job_id),
            artifact_id=uuid.UUID(artifact_id),
            provider_id=provider_id,
            model=model,
            guidance=guidance,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )


async def _run_suggest(
    *,
    job_id: uuid.UUID,
    project_id: uuid.UUID,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """Do the actual work for one suggest-TOC job.

    Mirrors `_run`'s exact shape (idempotency check, key resolution, the
    `running` write, shred-on-every-exit-path) — suggest-TOC persists
    nothing, so the job's `result` carries the suggested TOC dict directly
    instead of a created row's id. `recorded_by_sub` isn't used by the
    generator itself; it's kept in the signature for symmetry with
    `generate_topic_task`/`_run` and in case a future audit trail needs it.
    """
    r = _redis_client()
    api_key: str | None = None
    try:
        # (a) Idempotency — a redelivered/retried task (task_acks_late) must
        # not do the LLM call twice for the same job.
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

        # (c) Load the project + its sources.
        # A fresh asyncpg connection — the Celery worker has no FastAPI pool.
        conn = await _db_connect()
        try:
            p = await project_repo.get_project(conn, project_id=project_id)
            if p is None:
                await _write_status(r, job_id, "failed", error="project not found")
                return
            sources = await project_repo.list_inputs(conn, project_id=project_id)
        finally:
            await conn.close()

        if not sources:
            await _write_status(
                r, job_id, "failed", error="add at least one source before suggesting a TOC"
            )
            return

        resolved_model = model or settings.anthropic_default_model
        await _write_status(r, job_id, "running")  # phase: queued -> running
        try:
            out = await asyncio.to_thread(
                suggest_toc,
                sources=sources,
                topic=p.topic,
                audience=p.audience,
                goal=p.goal,
                provider_id=provider_id,
                api_key=api_key,
                model=resolved_model,
            )
        except LLMSchemaError:
            log.warning("toc_suggest_failed", job_id=str(job_id), reason="schema")
            await _write_status(r, job_id, "failed", error="suggested TOC failed validation")
            return
        except LLMAuthError:
            log.warning("toc_suggest_failed", job_id=str(job_id), reason="auth")
            await _write_status(
                r,
                job_id,
                "failed",
                error="The API key was rejected by the provider. Check it in Settings.",
            )
            return
        except LLMRateLimitError:
            log.warning("toc_suggest_failed", job_id=str(job_id), reason="rate_limit")
            await _write_status(
                r,
                job_id,
                "failed",
                error="The provider is rate-limiting requests. Try again shortly.",
            )
            return
        except LLMError:
            log.warning("toc_suggest_failed", job_id=str(job_id), reason="llm_error")
            await _write_status(r, job_id, "failed", error="couldn't suggest an outline")
            return
        except Exception:
            # Defense in depth: never let a raw error escape with key material.
            log.warning("toc_suggest_failed", job_id=str(job_id), reason="unexpected")
            await _write_status(r, job_id, "failed", error="couldn't suggest an outline")
            return

        # (d) Success.
        toc = toc_output_to_view(out.parsed, sources)

        # Meter managed spend server-side (ADR-005 D6) — best-effort, after a
        # successful generation. BYOK jobs record nothing. Suggest-TOC persists
        # nothing else to the DB, so the read-only `conn` above was already
        # closed — open a fresh one just for the usage row. The outer
        # try/except is belt-and-suspenders so even `_db_connect`/
        # `get_or_create_account` can't fail the job.
        if managed:
            try:
                usage_conn = await _db_connect()
                try:
                    acct = await accounts_repo.get_or_create_account(
                        usage_conn, idp_sub=recorded_by_sub, email=None
                    )
                    await _record_trust_usage(
                        usage_conn,
                        account_id=acct.id,
                        provider=provider_id,
                        model=resolved_model,
                        input_tokens=out.total_input_tokens,
                        output_tokens=out.total_output_tokens,
                        job_id=job_id,
                    )
                finally:
                    await usage_conn.close()
            except Exception:
                log.warning("trust_managed_usage_record_failed", job_id=str(job_id))

        await _write_status(r, job_id, "done", result={"toc": toc})
    except Exception:
        # Defense in depth: an unhandled error anywhere above (DB, Redis,
        # decrypt) must still land as a SAFE failed status — never the raw
        # exception, which could carry key material in its message.
        log.warning("trust_suggest_toc_task_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="couldn't suggest an outline")
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


@celery_app.task(bind=True, name="trust.suggest_toc")
def suggest_toc_task(
    self,
    *,
    job_id: str,
    project_id: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run_suggest(
            job_id=uuid.UUID(job_id),
            project_id=uuid.UUID(project_id),
            provider_id=provider_id,
            model=model,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )


async def _run_book(
    *,
    job_id: uuid.UUID,
    project_id: uuid.UUID,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """The durable orchestrator: sequentially fan out per-topic generation over
    every TOC unit that has no `topic_version` yet (ADR-037 book generation).

    Unlike the single-shot per-topic / whole-book / suggest-TOC tasks above,
    progress is tracked in the durable Postgres `generation_job` row
    (`total`/`done`/`failed_topic_ids`/`status`) rather than the ephemeral
    Redis job-status row — a submit endpoint (a later task) creates that row
    before enqueueing this task, and the mobile client polls it directly
    rather than the shared `GET /api/v1/jobs/{id}`.

    The provider key is still resolved via the SAME Redis envelope / vault-key
    mechanism as every other trust generation task (ADR-001) — decrypted ONCE
    up front and reused across every topic generated below, then shredded on
    every exit path. The per-topic generate/persist step (key resolution
    aside) is a faithful copy of `_run`'s section (c) — same source scoping,
    same `S{n}` source-label → source_id mapping, same `topic_version` shape.

    For a MANAGED job, every topic re-checks the account's managed grant and
    spend cap (`resolve_managed_access` / `over_cap`) immediately before that
    topic's generation call — the cap can be crossed mid-book by the topics
    already generated in THIS run, not just prior usage — and halts the job
    (status='halted') the moment either check fails, without attempting that
    topic. A per-topic generation failure (LLM/schema/etc) is instead recorded
    in `failed_topic_ids` and the loop CONTINUES to the next topic.

    Never raises: every exit path — success, a job-wide failure (missing
    job/project/key), a per-topic failure, or an unexpected error — writes a
    terminal-ish `generation_job` status (or, for per-topic failures, just
    records the failure and keeps going) and shreds the BYOK envelope.
    """
    r = _redis_client()
    api_key: str | None = None
    conn: asyncpg.Connection | None = None
    try:
        conn = await _db_connect()

        job = await generation_job_repo.get(conn, job_id=job_id)
        if job is None:
            log.warning("book_job_not_found", job_id=str(job_id))
            return
        done = job.done

        # (a) Resolve the provider key: managed = OUR vault key (ADR-005 D6),
        # BYOK = decrypt the per-job envelope. Same mechanism as `_run`, but
        # resolved ONCE — every topic in the loop below reuses it.
        if managed:
            api_key = get_managed_key(provider_id)
            if not api_key:
                log.warning("managed_key_missing", job_id=str(job_id), provider=provider_id)
                await generation_job_repo.update_progress(conn, job_id=job_id, status="failed")
                return
        else:
            envelope_blob = await r.get(_byok_redis_key(job_id))
            if envelope_blob is None:
                # TTL expired before the worker picked up the job.
                log.warning("envelope_missing", job_id=str(job_id))
                await generation_job_repo.update_progress(conn, job_id=job_id, status="failed")
                return
            try:
                master_key = parse_master_key(settings.byok_master_key)
                api_key = decrypt_api_key(master_key, str(job_id), envelope_blob)
            except Exception:
                log.warning("envelope_decrypt_failed", job_id=str(job_id))
                await generation_job_repo.update_progress(conn, job_id=job_id, status="failed")
                return

        # (b) Load the project + the still-missing TOC units.
        p = await project_repo.get_project(conn, project_id=project_id)
        if p is None:
            await generation_job_repo.update_progress(conn, job_id=job_id, status="failed")
            return

        existing_versions = await topic_repo.list_topic_versions(conn, project_id=project_id)
        existing = {tv.topic_id for tv in existing_versions}
        missing = book_gen.missing_topics(p, existing)

        all_inputs = await project_repo.list_inputs(conn, project_id=project_id)
        inputs_by_id = {str(i.id): i for i in all_inputs}
        resolved_model = model or settings.anthropic_default_model

        await generation_job_repo.update_progress(conn, job_id=job_id, status="running")

        account_id = None
        if managed:
            acct = await accounts_repo.get_or_create_account(
                conn, idp_sub=recorded_by_sub, email=None
            )
            account_id = acct.id

        # (c) Sequential fan-out — one topic at a time.
        for unit in missing:
            unit_id = str(unit.get("id"))

            if managed:
                # Reconstruct a minimal Principal so the staff-allowlist half of
                # `resolve_managed_access` (email/sub, not just an entitlement row)
                # matches what the Task-4 submit endpoint already checked with a
                # real Principal — `principal=None` here would silently make an
                # allowlist-only (no-entitlement) account halt at topic 0.
                principal = Principal(
                    sub=recorded_by_sub, email=acct.email, issuer=settings.oidc_issuer
                )
                grant = await resolve_managed_access(
                    conn, account_id=account_id, provider_id=provider_id, principal=principal
                )
                if grant is None or await over_cap(conn, account_id=account_id, access=grant):
                    log.info("book_generation_halted_over_cap", job_id=str(job_id))
                    await generation_job_repo.update_progress(conn, job_id=job_id, status="halted")
                    return

            try:
                topic_title = unit.get("title") or ""
                subtopics = [
                    st.get("label") if isinstance(st, dict) else st
                    for st in (unit.get("subtopics") or [])
                ]
                topic_source_ids = unit.get("source_ids") or []
                sources = [inputs_by_id[sid] for sid in topic_source_ids if sid in inputs_by_id]
                if not sources:
                    raise ValueError("no sources for this topic")

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

                by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
                sections = [
                    {
                        "heading": sec.heading,
                        "body": sec.body,
                        "source_ids": [
                            by_label[label] for label in sec.sources if label in by_label
                        ],
                    }
                    for sec in out.parsed.sections
                ]
                await topic_repo.create_topic_version(
                    conn,
                    project_id=project_id,
                    topic_id=unit_id,
                    title=topic_title,
                    source_ids=topic_source_ids,
                    content={"sections": sections},
                    created_by_sub=recorded_by_sub,
                    generation_meta={
                        "kind": "topic_draft",
                        "model": resolved_model,
                        "provider_id": provider_id,
                        "source_input_ids": topic_source_ids,
                    },
                )

                # Meter managed spend server-side (ADR-005 D6) — best-effort,
                # after a successful generation + persist; `_record_trust_usage`
                # already swallows its own errors so metering can never fail
                # the topic whose content is already persisted.
                if managed:
                    await _record_trust_usage(
                        conn,
                        account_id=account_id,
                        provider=provider_id,
                        model=resolved_model,
                        input_tokens=out.total_input_tokens,
                        output_tokens=out.total_output_tokens,
                        job_id=job_id,
                    )

                done += 1
                await generation_job_repo.update_progress(conn, job_id=job_id, done=done)
            except Exception:
                # Defense in depth: a per-topic failure (schema/LLM/no-sources/
                # unexpected) never aborts the book — record it and continue.
                log.warning("book_topic_generation_failed", job_id=str(job_id), topic_id=unit_id)
                await generation_job_repo.update_progress(
                    conn, job_id=job_id, add_failed_topic_id=unit_id
                )

        await generation_job_repo.update_progress(conn, job_id=job_id, status="done")
    except Exception:
        # Defense in depth: an unhandled error anywhere above (DB, Redis,
        # decrypt) must still land as a SAFE 'failed' job status — never the
        # raw exception, which could carry key material in its message.
        log.warning("trust_generate_book_task_failed", job_id=str(job_id), reason="unexpected")
        if conn is not None:
            try:
                await generation_job_repo.update_progress(conn, job_id=job_id, status="failed")
            except Exception:
                log.warning("book_job_status_write_failed", job_id=str(job_id))
    finally:
        # (d) SHRED — drop our reference to the key and delete the envelope on
        # every exit path, managed or BYOK (DEL on a missing key is a
        # harmless no-op, so this is safe even when there was never an
        # envelope to begin with).
        if api_key is not None:
            del api_key
        await _shred_envelope(r, job_id)
        await r.aclose()
        if conn is not None:
            await conn.close()


@celery_app.task(bind=True, name="trust.generate_book")
def generate_book_task(
    self,
    *,
    job_id: str,
    project_id: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run_book(
            job_id=uuid.UUID(job_id),
            project_id=uuid.UUID(project_id),
            provider_id=provider_id,
            model=model,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )
