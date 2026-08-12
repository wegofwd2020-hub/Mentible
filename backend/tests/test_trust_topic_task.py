"""TDD for the per-topic generate Celery task (Phase A, T2).

`generate_topic_task` / its async body `_run` is the worker side of
`POST /api/v1/trust/projects/{project_id}/topics/{topic_id}/generate` — it
resolves the provider key (BYOK envelope decrypt, or the managed vault key),
generates the topic draft, persists a `topic_version`, and writes the job
status row. Mirrors `backend/src/generate/tasks.py`'s job machinery so the
shared `GET /api/v1/jobs/{id}` polling endpoint works for both job kinds.

ADR-001 is non-negotiable here: the BYOK key must NEVER appear in the
serialized status payload (`test_status_payload_never_contains_the_key`), and
the encrypted envelope must be deleted from Redis after the run on both the
success and failure paths.
"""

from __future__ import annotations

import json
import os
import uuid
from unittest.mock import patch

import asyncpg
import fakeredis.aioredis
import pytest
from wegofwd_llm.errors import LLMSchemaError

from backend.config import settings
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.generate.tasks import _byok_redis_key, _job_status_redis_key
from backend.src.trust import project_repo, tasks as trust_tasks, topic_repo
from backend.tests.helpers import fake_provider

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

_MASTER_KEY = parse_master_key(settings.byok_master_key)
_API_KEY = "sk-ant-" + "k" * 20

_GOOD = json.dumps(
    {"sections": [{"heading": "Staff & clef", "body": "The staff has 5 lines.", "sources": ["S1"]}]}
)


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction()
    await tx.start()
    try:
        yield c
    finally:
        await tx.rollback()
        await c.close()


@pytest.fixture
async def fake_redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=False)
    try:
        yield r
    finally:
        await r.aclose()


@pytest.fixture(autouse=True)
def _patch_redis_client(fake_redis):
    """The task builds its own Redis connection from settings (Celery task
    args are JSON — a live client can't ride along). Point it at the test's
    fakeredis instance instead of a real Redis."""
    with patch("backend.src.trust.tasks._redis_client", return_value=fake_redis):
        yield


class _NoCloseConn:
    """Proxies every call to the wrapped connection except `close()`.

    The task opens its OWN DB connection and closes it when done (mirrors
    production — the Celery worker has no shared pool). In tests that
    connection must be the SAME one the `conn` fixture seeded data through
    (a second real connection can't see the fixture's uncommitted rows), and
    that fixture — not the task — owns the connection's lifecycle (it rolls
    back + closes at teardown). So `close()` here is a deliberate no-op.
    """

    def __init__(self, inner):
        self._inner = inner

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def close(self):
        pass


@pytest.fixture(autouse=True)
def _patch_db_connect(conn):
    async def _fake_connect():
        return _NoCloseConn(conn)

    with patch("backend.src.trust.tasks._db_connect", _fake_connect):
        yield


async def _project_with_topic(conn, *, with_source=True):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(conn, owner_account_id=a, title="Guide")
    source_ids: list[str] = []
    if with_source:
        inp = await project_repo.add_input(
            conn,
            project_id=p.id,
            kind="note",
            title="N",
            content="The staff has five lines; the clef fixes pitch.",
        )
        source_ids = [str(inp.id)]
    toc = {
        "subjects": [
            {
                "title": "Music",
                "units": [
                    {
                        "id": "t1",
                        "title": "Reading music",
                        "subtopics": ["Staff & clef"],
                        "source_ids": source_ids,
                    }
                ],
            }
        ]
    }
    await project_repo.update_project_toc(conn, project_id=p.id, toc=toc)
    return p.id, source_ids


async def _seed_byok_envelope(fake_redis, job_id: uuid.UUID, key: str = _API_KEY) -> None:
    envelope = encrypt_api_key(_MASTER_KEY, str(job_id), key)
    await fake_redis.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)


async def _status(fake_redis, job_id: uuid.UUID) -> dict:
    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert raw is not None, "no status row written"
    return json.loads(raw)


# ── Happy path ────────────────────────────────────────────────────────────────


async def test_task_produces_a_topic_version_and_writes_done(conn, fake_redis):
    pid, source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert body["result"]["topic_id"] == "t1"
    assert body["result"]["version_no"] == 1
    version_id = uuid.UUID(body["result"]["version_id"])

    v = await topic_repo.get_topic_version(conn, topic_version_id=version_id)
    assert v.title == "Reading music"
    assert v.content["sections"][0]["heading"] == "Staff & clef"
    assert v.content["sections"][0]["source_ids"] == source_ids
    assert v.generation_meta["kind"] == "topic_draft"
    assert v.generation_meta["source_input_ids"] == source_ids


async def test_task_stores_guidance_in_generation_meta(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance="keep it concise",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    version_id = uuid.UUID(body["result"]["version_id"])
    v = await topic_repo.get_topic_version(conn, topic_version_id=version_id)
    assert v.generation_meta["guidance"] == "keep it concise"


async def test_task_uses_the_managed_vault_key_when_managed(conn, fake_redis, monkeypatch):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    # No envelope seeded — managed jobs never touch Redis for the key.
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=True,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"


# ── Failure path ──────────────────────────────────────────────────────────────


async def test_provider_error_writes_failed_status(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        side_effect=LLMSchemaError("bad json"),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    assert "error" in body
    versions = await topic_repo.list_topic_versions(conn, project_id=pid)
    assert versions == []


async def test_unknown_topic_writes_failed_status(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    await trust_tasks._run(
        job_id=job_id,
        project_id=pid,
        topic_id="does-not-exist",
        provider_id="anthropic",
        model="m",
        guidance=None,
        managed=False,
        recorded_by_sub="owner-sub",
    )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"


# ── ADR-001: the key never leaks into the status payload ──────────────────────


async def test_status_payload_never_contains_the_key_on_success(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert _API_KEY not in raw.decode("utf-8")


async def test_status_payload_never_contains_the_key_on_provider_error(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    # The most dangerous case: the provider raises with the key baked into
    # the exception message.
    leaky = fake_provider(side_effect=RuntimeError(f"upstream rejected key={_API_KEY}"))
    with patch("backend.src.trust.generate_topic.build_provider", return_value=leaky):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert _API_KEY not in raw.decode("utf-8")


# ── Envelope shredding ──────────────────────────────────────────────────────────


async def test_envelope_deleted_after_success(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


async def test_envelope_deleted_after_failure(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        side_effect=LLMSchemaError("bad json"),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


async def test_envelope_delete_is_a_noop_on_the_managed_path(conn, fake_redis, monkeypatch):
    """Managed jobs never write an envelope; shredding a nonexistent key must
    not raise."""
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=True,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert await fake_redis.get(_byok_redis_key(job_id)) is None


# ── Idempotency ───────────────────────────────────────────────────────────────


async def test_idempotent_rerun_does_not_duplicate_the_version(conn, fake_redis):
    pid, _source_ids = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )
        # A redelivered task (task_acks_late) re-runs with the same job_id.
        # The envelope is already shredded — a naive re-run would fail trying
        # to re-decrypt, which is itself evidence the idempotency check must
        # come BEFORE key resolution.
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model="m",
            guidance=None,
            managed=False,
            recorded_by_sub="owner-sub",
        )

    versions = await topic_repo.list_topic_versions(conn, project_id=pid)
    assert len(versions) == 1
    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"


# ── The Celery task wrapper itself ──────────────────────────────────────────────


def test_generate_topic_task_registered():
    assert "trust.generate_topic" in trust_tasks.celery_app.tasks


def test_generate_topic_task_wraps_run_via_asyncio_run():
    """The Celery entrypoint is a thin sync wrapper — `asyncio.run(_run(...))`.

    Verified via `.apply()` (no broker/worker needed — runs the task body
    directly in-process) with `_run` monkeypatched, called from a SYNC test so
    `asyncio.run()` isn't nested inside pytest-asyncio's already-running loop
    (which the DB-backed `_run(...)`-calling tests above avoid by calling
    `_run` directly instead of going through this Celery entrypoint)."""
    calls: dict = {}

    async def _fake_run(**kwargs):
        calls.update(kwargs)

    with patch("backend.src.trust.tasks._run", _fake_run):
        trust_tasks.generate_topic_task.apply(
            kwargs={
                "job_id": "11111111-1111-1111-1111-111111111111",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "topic_id": "t1",
                "provider_id": "anthropic",
                "model": "m",
                "guidance": "g",
                "managed": False,
                "recorded_by_sub": "sub-1",
            }
        ).get()

    assert calls["topic_id"] == "t1"
    assert calls["provider_id"] == "anthropic"
    assert calls["managed"] is False
    assert str(calls["job_id"]) == "11111111-1111-1111-1111-111111111111"
