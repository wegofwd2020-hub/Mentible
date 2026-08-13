"""TDD for managed usage metering on the 3 trust async generators (ADR-005 D6).

`backend/src/generate/tasks.py::run_generation` (the main whole-lesson `/generate`
path) has always metered managed generations via `_record_managed_usage`. The 3
trust async generators — per-topic (`_run`), suggest-TOC (`_run_suggest`), and
whole-book draft (`_run_version`) in `backend/src/trust/tasks.py` — did NOT: their
generator functions (`generate_topic_draft`, `suggest_toc`, `generate_draft`)
discarded the `ConformanceResult` and returned only `.parsed`, so the observed
token counts never reached a `usage_event` row. Managed trust generation was
uncounted, undercounting the in-shell usage meter.

This file exercises the fix's DB-visible effect: a managed trust generation
writes exactly one `usage_event` row priced from the observed token counts; a
BYOK generation writes none; and a `usage_repo.record_usage` failure never
fails the job (ADR-005 — metering is best-effort, never blocking; ADR-001 — no
key material anywhere in a usage row or log).

Mirrors `test_trust_version_task.py`'s fixtures (same `conn`/`fake_redis`
machinery, same `_NoCloseConn` trick for sharing the fixture's rollback-isolated
transaction with the task's own `_db_connect()`).
"""

from __future__ import annotations

import json
import os
import uuid
from unittest.mock import patch

import asyncpg
import fakeredis.aioredis
import pytest

from backend.config import settings
from backend.src.billing import pricing
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.generate.tasks import _byok_redis_key, _job_status_redis_key
from backend.src.trust import artifact_repo, project_repo
from backend.src.trust import tasks as trust_tasks
from backend.tests.helpers import fake_provider

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

_MASTER_KEY = parse_master_key(settings.byok_master_key)
_API_KEY = "sk-ant-" + "k" * 20
_RECORDED_BY_SUB = "owner-sub"
_MODEL = "claude-sonnet-4-6"  # a priced model (test_billing_metering: $3/$15 per 1M)

_GOOD_DRAFT = json.dumps(
    {
        "sections": [
            {
                "heading": "Design storm",
                "body": "Pipes are sized for the 10-year storm.",
                "sources": ["S1"],
            },
        ]
    }
)

_GOOD_TOPIC = json.dumps(
    {"sections": [{"heading": "Staff & clef", "body": "The staff has 5 lines.", "sources": ["S1"]}]}
)

_GOOD_TOC = json.dumps(
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
    with patch("backend.src.trust.tasks._redis_client", return_value=fake_redis):
        yield


class _NoCloseConn:
    """Proxies every call to the wrapped connection except `close()` — see
    `test_trust_version_task.py` for the full rationale (the task owns +
    closes its own connection in production; in tests the fixture must own
    that lifecycle so the task sees the fixture's uncommitted seed rows)."""

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


async def _project_with_artifact(conn, *, with_source=True):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(
        conn,
        owner_account_id=a,
        title="Guide",
        topic="stormwater",
        audience="engineers",
        goal="size pipes",
    )
    art = await artifact_repo.create_artifact(
        conn, project_id=p.id, role="cornerstone", format="guide"
    )
    if with_source:
        await project_repo.add_input(
            conn,
            project_id=p.id,
            kind="note",
            title="N",
            content="Pipes are sized for the 10-year storm.",
        )
    return p.id, art.id


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
    return p.id


async def _project_for_toc(conn, *, with_source=True):
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


async def _usage_events(conn, *, idp_sub: str) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT ue.* FROM usage_event ue
        JOIN account a ON a.id = ue.account_id
        WHERE a.idp_sub = $1
        """,
        idp_sub,
    )
    return [dict(r) for r in rows]


async def _all_usage_events(conn) -> list[dict]:
    rows = await conn.fetch("SELECT * FROM usage_event")
    return [dict(r) for r in rows]


# ── Whole-book draft (_run_version) ─────────────────────────────────────────────


async def test_managed_whole_book_job_records_one_usage_event(conn, fake_redis, monkeypatch):
    _pid, aid = await _project_with_artifact(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.generate.build_provider",
        return_value=fake_provider(text=_GOOD_DRAFT, model=_MODEL),
    ):
        await trust_tasks._run_version(
            job_id=job_id,
            artifact_id=aid,
            provider_id="anthropic",
            model=_MODEL,
            guidance=None,
            managed=True,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"

    events = await _usage_events(conn, idp_sub=_RECORDED_BY_SUB)
    assert len(events) == 1
    ev = events[0]
    assert ev["provider"] == "anthropic"
    assert ev["model"] == _MODEL
    assert ev["input_tokens"] == 100  # fake_provider's default token counts
    assert ev["output_tokens"] == 500
    assert ev["cost_micros"] == pricing.cost_micros("anthropic", _MODEL, 100, 500)
    assert ev["job_id"] == job_id


async def test_byok_whole_book_job_records_zero_usage_events(conn, fake_redis):
    _pid, aid = await _project_with_artifact(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate.build_provider",
        return_value=fake_provider(text=_GOOD_DRAFT, model=_MODEL),
    ):
        await trust_tasks._run_version(
            job_id=job_id,
            artifact_id=aid,
            provider_id="anthropic",
            model=_MODEL,
            guidance=None,
            managed=False,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert await _all_usage_events(conn) == []


async def test_managed_whole_book_job_survives_record_usage_raising(conn, fake_redis, monkeypatch):
    """Metering must never fail the job — if `record_usage` blows up, the job
    still completes and the version is still persisted."""
    _pid, aid = await _project_with_artifact(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    async def _explode(*a, **k):
        raise RuntimeError("db down")

    with (
        patch(
            "backend.src.trust.generate.build_provider",
            return_value=fake_provider(text=_GOOD_DRAFT, model=_MODEL),
        ),
        patch("backend.src.trust.tasks.usage_repo.record_usage", _explode),
    ):
        await trust_tasks._run_version(
            job_id=job_id,
            artifact_id=aid,
            provider_id="anthropic",
            model=_MODEL,
            guidance=None,
            managed=True,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    version_id = uuid.UUID(body["result"]["version_id"])
    v = await artifact_repo.get_version(conn, version_id=version_id)
    assert v.content["sections"][0]["heading"] == "Design storm"


# ── Per-topic draft (_run) ───────────────────────────────────────────────────────


async def test_managed_per_topic_job_records_one_usage_event(conn, fake_redis, monkeypatch):
    pid = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD_TOPIC, model=_MODEL),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model=_MODEL,
            guidance=None,
            managed=True,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"

    events = await _usage_events(conn, idp_sub=_RECORDED_BY_SUB)
    assert len(events) == 1
    assert events[0]["cost_micros"] == pricing.cost_micros("anthropic", _MODEL, 100, 500)


async def test_byok_per_topic_job_records_zero_usage_events(conn, fake_redis):
    pid = await _project_with_topic(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_GOOD_TOPIC, model=_MODEL),
    ):
        await trust_tasks._run(
            job_id=job_id,
            project_id=pid,
            topic_id="t1",
            provider_id="anthropic",
            model=_MODEL,
            guidance=None,
            managed=False,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert await _all_usage_events(conn) == []


# ── Suggest-TOC (_run_suggest) ───────────────────────────────────────────────────


async def test_managed_suggest_toc_job_records_one_usage_event(conn, fake_redis, monkeypatch):
    pid = await _project_for_toc(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.toc_suggest.build_provider",
        return_value=fake_provider(text=_GOOD_TOC, model=_MODEL),
    ):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model=_MODEL,
            managed=True,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"

    events = await _usage_events(conn, idp_sub=_RECORDED_BY_SUB)
    assert len(events) == 1
    assert events[0]["cost_micros"] == pricing.cost_micros("anthropic", _MODEL, 100, 500)


async def test_byok_suggest_toc_job_records_zero_usage_events(conn, fake_redis):
    pid = await _project_for_toc(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.toc_suggest.build_provider",
        return_value=fake_provider(text=_GOOD_TOC, model=_MODEL),
    ):
        await trust_tasks._run_suggest(
            job_id=job_id,
            project_id=pid,
            provider_id="anthropic",
            model=_MODEL,
            managed=False,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert await _all_usage_events(conn) == []


# ── ADR-001: no key material in any usage row ────────────────────────────────────


async def test_usage_event_never_contains_the_api_key(conn, fake_redis, monkeypatch):
    _pid, aid = await _project_with_artifact(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.generate.build_provider",
        return_value=fake_provider(text=_GOOD_DRAFT, model=_MODEL),
    ):
        await trust_tasks._run_version(
            job_id=job_id,
            artifact_id=aid,
            provider_id="anthropic",
            model=_MODEL,
            guidance=None,
            managed=True,
            recorded_by_sub=_RECORDED_BY_SUB,
        )

    events = await _usage_events(conn, idp_sub=_RECORDED_BY_SUB)
    assert len(events) == 1
    row_str = json.dumps({k: str(v) for k, v in events[0].items()})
    assert _API_KEY not in row_str
