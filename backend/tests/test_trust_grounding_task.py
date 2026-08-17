"""TDD for the grounding-check Celery task (P1-4 T4).

`grounding_check_task` / its async body `_run_grounding_check` is the worker
side of `POST .../artifacts/versions/{version_id}/grounding-check` and
`POST .../topic-versions/{version_id}/grounding-check` — it resolves the
provider key (BYOK envelope decrypt, or the managed vault key), audits an
existing version's sections against the project's live sources, and upserts
the report into `version_grounding`. Mirrors `test_trust_version_task.py`'s
harness for `_run_version` (same key-resolution shape, copied verbatim).

ADR-001 is non-negotiable here too: the BYOK key must NEVER appear in the
serialized status payload, and the encrypted envelope must be deleted from
Redis after the run on both the success and failure paths.
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
from backend.src.trust import artifact_repo, grounding_repo, project_repo
from backend.src.trust import tasks as trust_tasks
from backend.tests.helpers import fake_provider

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

_MASTER_KEY = parse_master_key(settings.byok_master_key)
_API_KEY = "sk-ant-" + "k" * 20

_GOOD = json.dumps(
    {"claims": [{"text": "Pipes are sized for the 10-year storm.", "status": "supported", "sources": ["S1"]}]}
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


async def _project_with_version(conn):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(
        conn, owner_account_id=a, title="Guide", topic="stormwater", audience="engineers", goal="size pipes"
    )
    inp = await project_repo.add_input(
        conn, project_id=p.id, kind="note", title="N", content="Pipes are sized for the 10-year storm."
    )
    art = await artifact_repo.create_artifact(conn, project_id=p.id, role="cornerstone", format="guide")
    v = await artifact_repo.create_version(
        conn,
        artifact_id=art.id,
        content={
            "sections": [
                {
                    "heading": "Design storm",
                    "body": "Pipes are sized for the 10-year storm.",
                    "source_ids": [str(inp.id)],
                }
            ]
        },
        created_by_sub="owner-sub",
    )
    return v.id


async def _seed_byok_envelope(fake_redis, job_id: uuid.UUID, key: str = _API_KEY) -> None:
    envelope = encrypt_api_key(_MASTER_KEY, str(job_id), key)
    await fake_redis.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)


async def _status(fake_redis, job_id: uuid.UUID) -> dict:
    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert raw is not None, "no status row written"
    return json.loads(raw)


# ── Happy path ────────────────────────────────────────────────────────────────


async def test_task_upserts_report_and_writes_done(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.grounding.build_provider", return_value=fake_provider(text=_GOOD)):
        await trust_tasks._run_grounding_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert body["result"] == {"version_id": str(version_id), "version_kind": "artifact"}

    stored = await grounding_repo.get(conn, version_id=version_id, version_kind="artifact")
    assert stored is not None
    assert stored["supported"] == 1


async def test_task_uses_the_managed_vault_key_when_managed(conn, fake_redis, monkeypatch):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch("backend.src.trust.grounding.build_provider", return_value=fake_provider(text=_GOOD)):
        await trust_tasks._run_grounding_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=True,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"


# ── Failure path ──────────────────────────────────────────────────────────────


async def test_unknown_version_writes_failed_status(conn, fake_redis):
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    await trust_tasks._run_grounding_check(
        job_id=job_id,
        version_id=uuid.uuid4(),
        version_kind="artifact",
        provider_id="anthropic",
        model="m",
        managed=False,
    )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    assert body["error"] == "version not found"


async def test_provider_error_writes_failed_status(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.grounding.build_provider", side_effect=LLMSchemaError("bad json")):
        await trust_tasks._run_grounding_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    stored = await grounding_repo.get(conn, version_id=version_id, version_kind="artifact")
    assert stored is None


# ── ADR-001: the key never leaks into the status payload ──────────────────────


async def test_status_payload_never_contains_the_key_on_success(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.grounding.build_provider", return_value=fake_provider(text=_GOOD)):
        await trust_tasks._run_grounding_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
        )

    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert _API_KEY not in raw.decode("utf-8")


# ── Envelope shredding ──────────────────────────────────────────────────────────


async def test_envelope_deleted_after_success(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.grounding.build_provider", return_value=fake_provider(text=_GOOD)):
        await trust_tasks._run_grounding_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


async def test_envelope_deleted_after_failure(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch("backend.src.trust.grounding.build_provider", side_effect=LLMSchemaError("bad json")):
        await trust_tasks._run_grounding_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


# ── Re-run upserts rather than duplicating ───────────────────────────────────


async def test_rerun_upserts_the_same_row(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id_1 = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id_1)
    with patch("backend.src.trust.grounding.build_provider", return_value=fake_provider(text=_GOOD)):
        await trust_tasks._run_grounding_check(
            job_id=job_id_1,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
        )

    job_id_2 = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id_2)
    with patch("backend.src.trust.grounding.build_provider", return_value=fake_provider(text=_GOOD)):
        await trust_tasks._run_grounding_check(
            job_id=job_id_2,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m2",
            managed=False,
        )

    rows = await conn.fetch(
        "SELECT model FROM version_grounding WHERE version_id=$1 AND version_kind='artifact'",
        version_id,
    )
    assert len(rows) == 1
    assert rows[0]["model"] == "m2"


# ── The Celery task wrapper itself ──────────────────────────────────────────────


def test_grounding_check_task_registered():
    assert "trust.grounding_check" in trust_tasks.celery_app.tasks


def test_grounding_check_task_wraps_run_grounding_check_via_asyncio_run():
    calls: dict = {}

    async def _fake_run(**kwargs):
        calls.update(kwargs)

    with patch("backend.src.trust.tasks._run_grounding_check", _fake_run):
        trust_tasks.grounding_check_task.apply(
            kwargs={
                "job_id": "11111111-1111-1111-1111-111111111111",
                "version_id": "22222222-2222-2222-2222-222222222222",
                "version_kind": "artifact",
                "provider_id": "anthropic",
                "model": "m",
                "managed": False,
            }
        ).get()

    assert str(calls["version_id"]) == "22222222-2222-2222-2222-222222222222"
    assert calls["version_kind"] == "artifact"
    assert calls["managed"] is False
    assert str(calls["job_id"]) == "11111111-1111-1111-1111-111111111111"
