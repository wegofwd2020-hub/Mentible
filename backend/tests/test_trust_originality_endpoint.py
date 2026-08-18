"""TDD for the originality-check endpoints + `version_originality`
persistence (B3 T2): `POST .../artifacts/versions/{version_id}/originality-check`
and `POST .../topic-versions/{version_id}/originality-check` submit an async
job (mirrors `grounding-check`'s eligibility/envelope/enqueue shape —
owner-only, billable) whose worker (`originality_check_task`) upserts a
stored report into `version_originality`. `GET /versions/{id}` /
`GET /topic-versions/{id}` then surface that stored report (+ a `stale`
flag) as `quality.originality`.
"""

from __future__ import annotations

import os
import uuid
from unittest.mock import patch

import asyncpg
import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.redis_dep import get_redis
from backend.src.trust import originality_repo, project_repo
from backend.src.trust import tasks as trust_tasks
from backend.src.trust import topic_repo as trust_topic_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def _as(sub, email):
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _redis():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=False)
    app.dependency_overrides[get_redis] = lambda: fake
    yield fake


def _artifact_version_with_source(c):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    inp = c.post(
        f"/api/v1/trust/projects/{pid}/inputs",
        json={"kind": "note", "title": "Src", "content": "some source content"},
    ).json()
    art = c.post(
        f"/api/v1/trust/projects/{pid}/artifacts",
        json={"role": "cornerstone", "format": "guide"},
    ).json()
    content = {
        "sections": [{"heading": "A", "body": "The cat sat on the mat.", "source_ids": [inp["id"]]}]
    }
    ver = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": content}).json()
    return pid, ver["id"], inp["id"]


def test_owner_submits_originality_check_returns_202_and_enqueues():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, vid, _iid = _artifact_version_with_source(c)
        key = "sk-ant-" + "e" * 20

        with patch("backend.src.trust.router.originality_check_task.delay") as mock_delay:
            r = c.post(
                f"/api/v1/trust/artifacts/versions/{vid}/originality-check",
                json={"api_key": key},
            )
        assert r.status_code == 202, r.text
        assert key not in r.text  # ADR-001: the submitted key never leaks into the response
        body = r.json()
        assert body["status"] == "queued"

        mock_delay.assert_called_once()
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["job_id"] == body["job_id"]
        assert kwargs["version_id"] == vid
        assert kwargs["version_kind"] == "artifact"
        assert kwargs["managed"] is False
        assert kwargs["recorded_by_sub"] == owner
        assert "api_key" not in kwargs  # ADR-001: the key never rides along in task args

        job = c.get(f"/api/v1/jobs/{body['job_id']}").json()
        assert job["status"] == "queued"


async def _insert_topic_version(project_id, owner_sub, input_id):
    conn = await asyncpg.connect(DSN)
    try:
        v = await trust_topic_repo.create_topic_version(
            conn,
            project_id=uuid.UUID(project_id),
            topic_id="t1",
            title="T1",
            source_ids=[input_id],
            content={"sections": [{"heading": "H", "body": "b", "source_ids": [input_id]}]},
            created_by_sub=owner_sub,
        )
        return str(v.id)
    finally:
        await conn.close()


def test_owner_submits_topic_originality_check_returns_202_with_topic_kind():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        inp = c.post(
            f"/api/v1/trust/projects/{pid}/inputs",
            json={"kind": "note", "title": "Src", "content": "source"},
        ).json()

        import asyncio

        tvid = asyncio.run(_insert_topic_version(pid, owner, inp["id"]))

        with patch("backend.src.trust.router.originality_check_task.delay") as mock_delay:
            r = c.post(
                f"/api/v1/trust/topic-versions/{tvid}/originality-check",
                json={"api_key": "sk-ant-" + "e" * 20},
            )
        assert r.status_code == 202, r.text
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["version_id"] == tvid
        assert kwargs["version_kind"] == "topic"
        assert kwargs["recorded_by_sub"] == owner


def test_originality_check_unknown_version_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        r = c.post(
            f"/api/v1/trust/artifacts/versions/{uuid.uuid4()}/originality-check",
            json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 404


def test_reviewer_cannot_submit_originality_check_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, vid, _iid = _artifact_version_with_source(c)

        expert = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert})
        _as(f"e-{uuid.uuid4()}", expert)
        c.post("/api/v1/trust/session/sync")

        r = c.post(
            f"/api/v1/trust/artifacts/versions/{vid}/originality-check",
            json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 403


async def _upsert_report(version_id, version_kind, sources, cited_ids, *, model="m"):
    conn = await asyncpg.connect(DSN)
    try:
        report = {
            "sections": [
                {"index": 0, "heading": "H", "overlap": "none", "note": None, "source_ref": None}
            ],
            "summary": {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1},
        }
        await originality_repo.upsert(
            conn,
            version_id=uuid.UUID(version_id),
            version_kind=version_kind,
            report=report,
            model=model,
            cited_content_hash=trust_tasks.cited_content_hash(sources, cited_ids),
        )
    finally:
        await conn.close()


async def _set_input_content_hash(input_id, new_hash):
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute(
            "UPDATE project_input SET content_hash = $2 WHERE id = $1",
            uuid.UUID(input_id),
            new_hash,
        )
    finally:
        await conn.close()


async def _sources_for(project_id):
    conn = await asyncpg.connect(DSN)
    try:
        return await project_repo.list_inputs(conn, project_id=uuid.UUID(project_id))
    finally:
        await conn.close()


def test_stored_originality_surfaces_on_read_and_flips_stale():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, vid, iid = _artifact_version_with_source(c)

        import asyncio

        sources = asyncio.run(_sources_for(pid))
        asyncio.run(_upsert_report(vid, "artifact", sources, {iid}))

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200
        o = r.json()["quality"]["originality"]
        assert o is not None
        assert o["stale"] is False
        assert "cited_content_hash" not in o  # popped before returning

        asyncio.run(_set_input_content_hash(iid, "sha256:changed"))

        r2 = c.get(f"/api/v1/trust/versions/{vid}")
        o2 = r2.json()["quality"]["originality"]
        assert o2 is not None
        assert o2["stale"] is True


def test_no_stored_originality_is_none():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, vid, _iid = _artifact_version_with_source(c)

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.json()["quality"]["originality"] is None
