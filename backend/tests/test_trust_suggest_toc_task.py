"""TDD for the suggest-TOC Celery task (Phase B, T1).

`suggest_toc_task` / its async body `_run_suggest` is the worker side of
`POST /api/v1/trust/projects/{project_id}/suggest-toc` — it resolves the
provider key (BYOK envelope decrypt, or the managed vault key), suggests a
TOC, and writes the job status row. Unlike per-topic generate, suggest-TOC
persists nothing to the DB; the job's `done` result carries the suggested
`toc` dict directly. Mirrors `backend/src/generate/tasks.py`'s job machinery
(via `backend/src/trust/tasks.py`'s `_run`/`generate_topic_task`) so the
shared `GET /api/v1/jobs/{id}` polling endpoint works for this job kind too.

ADR-001 is non-negotiable here: the BYOK key must NEVER appear in the
serialized status payload (`test_task_writes_running_before_done`), and the
encrypted envelope must be deleted from Redis after the run on both the
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
from backend.src.trust import project_repo
from backend.src.trust import tasks as trust_tasks

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

_MASTER_KEY = parse_master_key(settings.byok_master_key)
_API_KEY = "sk-ant-" + "k" * 20

_GOOD = json.dumps(
    {
        "subjects": [
            {
                "subject_label": "Music",
                "topics": [
                    {
                        "title": "Reading music",
                        "subtopics": [{"label": "Staff & clef"}],
                        "sources": ["S1"],
                    }
                ],
            }
        ]
    }
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


async def _project(conn, *, with_source=True):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(
        conn, owner_account_id=a, title="Guide", topic="music", audience="beginners", goal="learn"
    )
    if with_source:
        await project_repo.add_input(
            conn,
            project_id=p.id,
            kind="note",
            title="N",
            content="The staff has five lines; the clef fixes pitch.",
        )
    return p.id


async def _seed_byok_envelope(fake_redis, job_id: uuid.UUID, key: str = _API_KEY) -> None:
    envelope = encrypt_api_key(_MASTER_KEY, str(job_id), key)
    await fake_redis.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)


async def _status(fake_redis, job_id: uuid.UUID) -> dict:
    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert raw is not None, "no status row written"
    return json.loads(raw)


# ── Happy path ────────────────────────────────────────────────────────────────


async def test_task_writes_done_with_toc_result(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.tasks.suggest_toc",
        return_value=_fake_toc_output(),
    ):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    toc = body["result"]["toc"]
    assert toc["subjects"][0]["subject_label"] == "Music"
    unit = toc["subjects"][0]["units"][0]
    assert unit["title"] == "Reading music"
    assert unit["subtopics"] == ["Staff & clef"]
    assert unit["source_ids"] != []
    assert all(len(sid) == 36 for sid in unit["source_ids"])  # real input uuids, not S-labels


def _fake_toc_output():
    from backend.src.trust.toc_suggest import _TocOutput

    return _TocOutput.model_validate(json.loads(_GOOD))


async def test_task_uses_the_managed_vault_key_when_managed(conn, fake_redis, monkeypatch):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    # No envelope seeded — managed jobs never touch Redis for the key.
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch("backend.src.trust.tasks.suggest_toc", return_value=_fake_toc_output()):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=True,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"


async def test_task_writes_running_before_done(conn, fake_redis, monkeypatch):
    """The task must write a `running` status when it actually starts work
    (after the no-sources guard, before the LLM call). Spies on
    `_write_status` to capture the emitted status sequence, and — per
    ADR-001 — asserts NO status payload ever carries the API key."""
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    seq: list[tuple[str, str]] = []
    orig = trust_tasks._write_status

    async def spy(r, jid, status, **kw):
        payload = {"status": status, **{k: v for k, v in kw.items() if v is not None}}
        seq.append((status, json.dumps(payload)))
        return await orig(r, jid, status, **kw)

    monkeypatch.setattr(trust_tasks, "_write_status", spy)

    with patch("backend.src.trust.tasks.suggest_toc", return_value=_fake_toc_output()):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    statuses = [s for s, _ in seq]
    assert "running" in statuses and "done" in statuses
    assert statuses.index("running") < statuses.index("done")
    # ADR-001: no status payload — not one — ever carries the key.
    for _s, payload in seq:
        assert _API_KEY not in payload


# ── Failure path ──────────────────────────────────────────────────────────────


async def test_source_less_project_fails_before_running(conn, fake_redis):
    """No sources → `failed` with the actionable message, and the failure
    happens BEFORE the `running` write (the guard is a fail-fast check, not
    a "start working then bail" one)."""
    pid = await _project(conn, with_source=False)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    seq: list[str] = []
    orig = trust_tasks._write_status

    async def spy(r, jid, status, **kw):
        seq.append(status)
        return await orig(r, jid, status, **kw)

    with patch.object(trust_tasks, "_write_status", spy):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert "running" not in seq
    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    assert body["error"] == "add at least one source before suggesting a TOC"


async def test_provider_error_writes_failed_status(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.tasks.suggest_toc",
        side_effect=LLMSchemaError("bad json"),
    ):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    assert body["error"] == "suggested TOC failed validation"


async def test_unknown_project_writes_failed_status(conn, fake_redis):
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    await trust_tasks._run_suggest(
        job_id=job_id,
        project_id=uuid.uuid4(),
        provider_id="anthropic",
        model="m",
        managed=False,
        recorded_by_sub="owner-sub",
    )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"


# ── ADR-001: the key never leaks into the status payload ──────────────────────


async def test_status_payload_never_contains_the_key_on_success(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.tasks.suggest_toc", return_value=_fake_toc_output()):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert _API_KEY not in raw.decode("utf-8")


async def test_status_payload_never_contains_the_key_on_provider_error(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    # The most dangerous case: the provider raises with the key baked into
    # the exception message.
    with patch(
        "backend.src.trust.tasks.suggest_toc",
        side_effect=RuntimeError(f"upstream rejected key={_API_KEY}"),
    ):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert _API_KEY not in raw.decode("utf-8")


# ── Envelope shredding ──────────────────────────────────────────────────────────


async def test_envelope_deleted_after_success(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.tasks.suggest_toc", return_value=_fake_toc_output()):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


async def test_envelope_deleted_after_failure(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.tasks.suggest_toc",
        side_effect=LLMSchemaError("bad json"),
    ):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


async def test_envelope_delete_is_a_noop_on_the_managed_path(conn, fake_redis, monkeypatch):
    """Managed jobs never write an envelope; shredding a nonexistent key must
    not raise."""
    pid = await _project(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch("backend.src.trust.tasks.suggest_toc", return_value=_fake_toc_output()):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=True,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert await fake_redis.get(_byok_redis_key(job_id)) is None


# ── Idempotency ───────────────────────────────────────────────────────────────


async def test_idempotent_rerun_does_not_call_the_provider_twice(conn, fake_redis):
    pid = await _project(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    calls = 0

    def _suggest(**_kwargs):
        nonlocal calls
        calls += 1
        return _fake_toc_output()

    with patch("backend.src.trust.tasks.suggest_toc", side_effect=_suggest):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )
        # A redelivered task (task_acks_late) re-runs with the same job_id.
        # The envelope is already shredded — a naive re-run would fail trying
        # to re-decrypt, which is itself evidence the idempotency check must
        # come BEFORE key resolution.
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert calls == 1
    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"


# ── The Celery task wrapper itself ──────────────────────────────────────────────


def test_suggest_toc_task_registered():
    assert "trust.suggest_toc" in trust_tasks.celery_app.tasks


def test_suggest_toc_task_wraps_run_suggest_via_asyncio_run():
    """The Celery entrypoint is a thin sync wrapper — `asyncio.run(_run_suggest(...))`.

    Verified via `.apply()` (no broker/worker needed — runs the task body
    directly in-process) with `_run_suggest` monkeypatched, called from a SYNC
    test so `asyncio.run()` isn't nested inside pytest-asyncio's already-running
    loop (which the DB-backed `_run_suggest(...)`-calling tests above avoid by
    calling `_run_suggest` directly instead of going through this Celery
    entrypoint)."""
    calls: dict = {}

    async def _fake_run_suggest(**kwargs):
        calls.update(kwargs)

    with patch("backend.src.trust.tasks._run_suggest", _fake_run_suggest):
        trust_tasks.suggest_toc_task.apply(
            kwargs={
                "job_id": "11111111-1111-1111-1111-111111111111",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "provider_id": "anthropic",
                "model": "m",
                "managed": False,
                "recorded_by_sub": "sub-1",
            }
        ).get()

    assert calls["provider_id"] == "anthropic"
    assert calls["managed"] is False
    assert str(calls["job_id"]) == "11111111-1111-1111-1111-111111111111"
