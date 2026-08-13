"""TDD for the whole-book fan-out orchestrator Celery task (Task 3).

`generate_book_task` / its async body `_run_book` is the durable worker side
of "generate the whole book" — it fans a per-topic generation out over every
TOC unit that has no `topic_version` yet, SEQUENTIALLY, persisting progress in
the durable `generation_job` Postgres row (not the ephemeral Redis job-status
row the single-shot per-topic/whole-book/suggest-TOC tasks use). Mirrors
`tasks.py`'s `_run` (per-topic, Phase A) for the provider-key resolution and
the topic-generate/persist shape — see `test_trust_topic_task.py`.

Three behaviors under test, per the task-3 brief:
  1. missing-only: a topic that already has a version is skipped.
  2. continue-on-fail: a per-topic generation failure is recorded in
     `failed_topic_ids` and the loop continues to the next topic.
  3. ceiling-halt: the managed cost cap being hit mid-book halts the job
     (status='halted') before attempting the topic that would exceed it.

The task must NEVER raise — every case above returns normally.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import asyncpg
import fakeredis.aioredis
import pytest
from wegofwd_llm.conformance import ConformanceResult

from backend.config import settings
from backend.src.billing import eligibility, entitlement_repo
from backend.src.billing.access import ManagedAccess
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.generate.tasks import _byok_redis_key
from backend.src.trust import generation_job_repo, project_repo, topic_repo
from backend.src.trust import tasks as trust_tasks

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

_MASTER_KEY = parse_master_key(settings.byok_master_key)
_API_KEY = "sk-ant-" + "k" * 20


def _draft(heading: str) -> ConformanceResult:
    """A canned, valid per-topic draft — enough shape for the section→
    topic_version mapping in `_run_book` (`.parsed.sections[i].heading/.body/
    .sources`)."""
    section = SimpleNamespace(heading=heading, body=f"Body for {heading}.", sources=["S1"])
    return ConformanceResult(
        parsed=SimpleNamespace(sections=[section]),
        response=None,
        attempts=1,
        repaired=False,
        total_input_tokens=100,
        total_output_tokens=200,
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
    with patch("backend.src.trust.tasks._redis_client", return_value=fake_redis):
        yield


class _NoCloseConn:
    """See `test_trust_topic_task.py` — proxies everything except `close()` so
    the task's own connection is the SAME one the fixture seeded data through."""

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


def _toc(unit_ids: list[str], source_ids: list[str]) -> dict:
    return {
        "subjects": [
            {
                "title": "Subject",
                "units": [
                    {
                        "id": uid,
                        "title": uid,
                        "subtopics": [],
                        "source_ids": source_ids,
                    }
                    for uid in unit_ids
                ],
            }
        ]
    }


async def _project_with_toc(conn, *, unit_ids=("u1", "u2", "u3"), skip_first_version=False):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(conn, owner_account_id=a, title="Guide")
    inp = await project_repo.add_input(
        conn, project_id=p.id, kind="note", title="N", content="Some grounding text."
    )
    source_ids = [str(inp.id)]
    toc = _toc(list(unit_ids), source_ids)
    await project_repo.update_project_toc(conn, project_id=p.id, toc=toc)
    if not skip_first_version:
        await topic_repo.create_topic_version(
            conn,
            project_id=p.id,
            topic_id=unit_ids[0],
            title=unit_ids[0],
            source_ids=source_ids,
            content={"sections": []},
            created_by_sub="owner-sub",
        )
    return p.id, source_ids


async def _seed_byok_envelope(fake_redis, job_id: uuid.UUID, key: str = _API_KEY) -> None:
    envelope = encrypt_api_key(_MASTER_KEY, str(job_id), key)
    await fake_redis.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)


async def _make_job(conn, *, project_id, total) -> uuid.UUID:
    job = await generation_job_repo.create(
        conn, project_id=project_id, total=total, created_by_sub="owner-sub"
    )
    return job.id


# ── 1. Missing-only ──────────────────────────────────────────────────────────


async def test_missing_only_generates_the_missing_topics(conn, fake_redis):
    pid, _source_ids = await _project_with_toc(conn)  # u1 already has a version
    job_id = await _make_job(conn, project_id=pid, total=2)
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.tasks.generate_topic_draft",
        side_effect=lambda **kw: _draft(kw["topic_title"]),
    ) as mock_gen:
        await trust_tasks._run_book(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert mock_gen.call_count == 2  # u1 skipped — only u2, u3 attempted

    job = await generation_job_repo.get(conn, job_id=job_id)
    assert job.status == "done"
    assert job.done == 2
    assert job.failed_topic_ids == []

    versions = await topic_repo.list_topic_versions(conn, project_id=pid)
    topic_ids = {v.topic_id for v in versions}
    assert topic_ids == {"u1", "u2", "u3"}  # u1's pre-seeded version + the 2 new ones


async def test_worker_rewrites_total_from_its_own_missing(conn, fake_redis):
    # F3 (fix round, final review): `total` is frozen at submit time
    # (len(missing) as of the submit request); if the TOC changed before the
    # worker picked the job up, the worker's own `missing` can differ from
    # that stale snapshot, skewing done/total ("9/8", or a complete job
    # reading unfinished). `_run_book` must re-write `total` from its own
    # `missing` right after flipping status to "running" — simulate a
    # submit-time total (1) that undercounts what the worker actually finds
    # missing (2: u2, u3) and assert the persisted `total` reflects the
    # worker's real count, with `done == total` on a clean run.
    pid, _source_ids = await _project_with_toc(conn)  # u1 has a version; u2, u3 missing
    job_id = await _make_job(conn, project_id=pid, total=1)
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.tasks.generate_topic_draft",
        side_effect=lambda **kw: _draft(kw["topic_title"]),
    ) as mock_gen:
        await trust_tasks._run_book(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert mock_gen.call_count == 2

    job = await generation_job_repo.get(conn, job_id=job_id)
    assert job.total == 2  # the worker's own missing count, not the stale submit-time 1
    assert job.done == job.total
    assert job.status == "done"


# ── 2. Continue-on-fail ───────────────────────────────────────────────────────


async def test_continue_on_fail_records_the_failed_topic_and_keeps_going(conn, fake_redis):
    pid, _source_ids = await _project_with_toc(conn)  # u1 already has a version
    job_id = await _make_job(conn, project_id=pid, total=2)
    await _seed_byok_envelope(fake_redis, job_id)

    def _gen(**kw):
        if kw["topic_title"] == "u3":
            raise RuntimeError("boom")
        return _draft(kw["topic_title"])

    with patch("backend.src.trust.tasks.generate_topic_draft", side_effect=_gen) as mock_gen:
        await trust_tasks._run_book(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    assert mock_gen.call_count == 2  # both u2 and u3 were attempted

    job = await generation_job_repo.get(conn, job_id=job_id)
    assert job.status == "done"
    assert job.done == 1
    assert job.failed_topic_ids == ["u3"]

    versions = await topic_repo.list_topic_versions(conn, project_id=pid)
    topic_ids = {v.topic_id for v in versions}
    assert topic_ids == {"u1", "u2"}  # u3 never persisted


# ── 3. Ceiling-halt ────────────────────────────────────────────────────────────


async def test_ceiling_halt_stops_before_the_over_cap_topic(conn, fake_redis, monkeypatch):
    pid, _source_ids = await _project_with_toc(conn)  # u1 already has a version
    job_id = await _make_job(conn, project_id=pid, total=2)
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    grant = ManagedAccess(allowance_micros=1_000_000, since=datetime.now(UTC), source="staff")
    monkeypatch.setattr(trust_tasks, "resolve_managed_access", AsyncMock(return_value=grant))
    monkeypatch.setattr(trust_tasks, "over_cap", AsyncMock(side_effect=[False, True]))

    with patch(
        "backend.src.trust.tasks.generate_topic_draft",
        side_effect=lambda **kw: _draft(kw["topic_title"]),
    ) as mock_gen:
        await trust_tasks._run_book(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=True,
            recorded_by_sub="owner-sub",
        )

    assert mock_gen.call_count == 1  # u2 generated; u3 never attempted

    job = await generation_job_repo.get(conn, job_id=job_id)
    assert job.status == "halted"
    assert job.done == 1
    assert job.failed_topic_ids == []  # halted, not failed — u3 wasn't attempted

    versions = await topic_repo.list_topic_versions(conn, project_id=pid)
    topic_ids = {v.topic_id for v in versions}
    assert topic_ids == {"u1", "u2"}


# ── 4. Worker Principal reconstruction — staff allowlist vs. entitlement ────────
#
# `resolve_managed_access` resolves a managed grant two ways: a plan entitlement
# (keyed by `account_id` alone) OR the staff allowlist (`is_managed_eligible`,
# which needs a real `Principal` — `sub`/`email` — and returns False immediately
# for `principal=None`). These two tests call `_run_book` WITHOUT stubbing
# `resolve_managed_access`, so they exercise the real eligibility resolution
# end to end.


async def test_staff_allowlist_managed_book_generates_not_halted(conn, fake_redis, monkeypatch):
    """A MANAGED account eligible ONLY via the config staff allowlist (no
    entitlement row) must still generate the topic and finish 'done' — proving
    `_run_book` reconstructs a real `Principal` from the account instead of
    calling `resolve_managed_access(principal=None)`, which would make
    `is_managed_eligible` return False and halt the book at topic 0 even
    though the Task-4 submit endpoint (a real Principal) already accepted it."""
    sub = f"staff-{uuid.uuid4()}"
    email = f"staff-{uuid.uuid4()}@example.com"
    # Pre-seed the account with its real stored email — `_run_book` reads it
    # back via `get_or_create_account(..., email=None)`, which must NOT wipe it.
    await conn.execute("INSERT INTO account (idp_sub, email) VALUES ($1, $2)", sub, email)

    pid, _source_ids = await _project_with_toc(conn, unit_ids=("u1",), skip_first_version=True)
    job_id = await _make_job(conn, project_id=pid, total=1)
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset({email}))

    with patch(
        "backend.src.trust.tasks.generate_topic_draft",
        side_effect=lambda **kw: _draft(kw["topic_title"]),
    ) as mock_gen:
        await trust_tasks._run_book(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=True,
            recorded_by_sub=sub,
        )

    assert mock_gen.call_count == 1

    job = await generation_job_repo.get(conn, job_id=job_id)
    assert job.status == "done"  # NOT 'halted' — the allowlist path resolved
    assert job.done == 1
    assert job.failed_topic_ids == []

    versions = await topic_repo.list_topic_versions(conn, project_id=pid)
    assert {v.topic_id for v in versions} == {"u1"}

    # The account's stored email must have survived the internal
    # `get_or_create_account(..., email=None)` read (no accidental NULL-out).
    row = await conn.fetchrow("SELECT email FROM account WHERE idp_sub = $1", sub)
    assert row["email"] == email


async def test_entitlement_managed_book_still_generates(conn, fake_redis, monkeypatch):
    """The entitlement path (no staff allowlist at all) still resolves and
    generates — the Principal-reconstruction fix must not regress the
    account_id-keyed entitlement branch of `resolve_managed_access`."""
    sub = f"ent-{uuid.uuid4()}"
    account_id = await conn.fetchval("INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", sub)
    now = datetime.now(UTC)
    await entitlement_repo.set_entitlement(
        conn,
        account_id=account_id,
        plan_id="managed_basic",
        status="active",
        period_start=now - timedelta(days=1),
        period_end=now + timedelta(days=29),
    )

    pid, _source_ids = await _project_with_toc(conn, unit_ids=("u1",), skip_first_version=True)
    job_id = await _make_job(conn, project_id=pid, total=1)
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())

    with patch(
        "backend.src.trust.tasks.generate_topic_draft",
        side_effect=lambda **kw: _draft(kw["topic_title"]),
    ) as mock_gen:
        await trust_tasks._run_book(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model="m",
            managed=True,
            recorded_by_sub=sub,
        )

    assert mock_gen.call_count == 1

    job = await generation_job_repo.get(conn, job_id=job_id)
    assert job.status == "done"
    assert job.done == 1
    assert job.failed_topic_ids == []


# ── The Celery task wrapper itself ──────────────────────────────────────────────


def test_generate_book_task_registered():
    assert "trust.generate_book" in trust_tasks.celery_app.tasks


def test_generate_book_task_wraps_run_book_via_asyncio_run():
    """The Celery entrypoint is a thin sync wrapper — `asyncio.run(_run_book(...))`.
    Verified via `.apply()` (no broker/worker needed), from a SYNC test so
    `asyncio.run()` isn't nested inside pytest-asyncio's already-running loop."""
    calls: dict = {}

    async def _fake_run_book(**kwargs):
        calls.update(kwargs)

    with patch("backend.src.trust.tasks._run_book", _fake_run_book):
        trust_tasks.generate_book_task.apply(
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
