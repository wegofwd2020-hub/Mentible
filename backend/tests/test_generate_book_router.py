import asyncio
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
from src.trust import topic_repo

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
    """Override the shared `get_redis` dependency with a fresh fakeredis
    instance per test — mirrors `test_trust_router.py`'s `_redis` fixture.
    The generate-book submit endpoint writes a BYOK envelope through this
    dependency for BYOK requests."""
    fake = fakeredis.aioredis.FakeRedis(decode_responses=False)
    app.dependency_overrides[get_redis] = lambda: fake
    yield fake


def _toc(units):
    """units: list of (topic_id, source_ids)."""
    return {
        "subjects": [
            {
                "subject_label": "S",
                "units": [
                    {
                        "id": uid,
                        "title": uid,
                        "subtopics": [],
                        "prerequisites": [],
                        "source_ids": sids,
                    }
                    for uid, sids in units
                ],
            }
        ]
    }


def _project_with_toc(c, units):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    iid = c.post(
        f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"}
    ).json()["id"]
    toc = _toc([(uid, [iid] if sids else []) for uid, sids in units])
    assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200
    return pid, iid


def test_owner_submits_with_one_missing_topic_returns_202_and_row():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc(c, [("u1", True)])
        key = "sk-ant-" + "e" * 20

        with patch("backend.src.trust.router.generate_book_task.delay") as mock_delay:
            r = c.post(
                f"/api/v1/trust/projects/{pid}/generate-book",
                json={"api_key": key},
            )
        assert r.status_code == 202, r.text
        assert key not in r.text  # ADR-001: the submitted key never leaks into the response
        body = r.json()
        assert body["total"] == 1
        job_id = body["job_id"]

        mock_delay.assert_called_once()
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["job_id"] == job_id
        assert kwargs["project_id"] == pid
        assert kwargs["managed"] is False
        assert kwargs["recorded_by_sub"] == owner

        # The BYOK envelope was written, encrypted — never the plaintext key.
        fake_redis = app.dependency_overrides[get_redis]()
        envelope = asyncio.run(fake_redis.get(f"byok:{job_id}"))
        assert envelope is not None
        assert key.encode() not in envelope

        # The durable row exists with total == missing.
        got = c.get(f"/api/v1/trust/generation-jobs/{job_id}").json()
        assert got["id"] == job_id
        assert got["project_id"] == pid
        assert got["total"] == 1
        assert got["done"] == 0
        assert got["status"] == "queued"
        assert got["failed_topic_ids"] == []


def test_owner_no_toc_returns_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/generate-book",
            json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 422, r.text


def test_owner_zero_missing_topics_returns_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, iid = _project_with_toc(c, [("u1", True)])

        # Generate the only topic directly via topic_repo so it's no longer missing.
        async def _seed():
            conn = await asyncpg.connect(DSN)
            try:
                await topic_repo.create_topic_version(
                    conn,
                    project_id=uuid.UUID(pid),
                    topic_id="u1",
                    title="u1",
                    source_ids=[iid],
                    content={"sections": []},
                    created_by_sub=owner,
                )
            finally:
                await conn.close()

        asyncio.run(_seed())

        r = c.post(
            f"/api/v1/trust/projects/{pid}/generate-book",
            json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 422, r.text


def test_reviewer_forbidden_on_submit():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc(c, [("u1", True)])
        expert_email = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        # expert redeems membership via session/sync, then becomes reviewer
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")

        r = c.post(
            f"/api/v1/trust/projects/{pid}/generate-book",
            json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 403


def test_get_generation_job_owner_only_and_404_unknown():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc(c, [("u1", True)])

        with patch("backend.src.trust.router.generate_book_task.delay"):
            r = c.post(
                f"/api/v1/trust/projects/{pid}/generate-book",
                json={"api_key": "sk-ant-" + "e" * 20},
            )
        job_id = r.json()["job_id"]

        # unknown job id -> 404
        assert c.get(f"/api/v1/trust/generation-jobs/{uuid.uuid4()}").status_code == 404

        # a non-member is refused
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        assert c.get(f"/api/v1/trust/generation-jobs/{job_id}").status_code == 403

        # the owner can read it
        _as(owner, f"{owner}@x.z")
        got = c.get(f"/api/v1/trust/generation-jobs/{job_id}").json()
        assert got["id"] == job_id


def test_latest_generation_job_returns_most_recent_and_null_when_none():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc(c, [("u1", True), ("u2", True)])

        # no jobs yet -> null
        r = c.get(f"/api/v1/trust/projects/{pid}/generation-jobs/latest")
        assert r.status_code == 200
        assert r.json() is None

        with patch("backend.src.trust.router.generate_book_task.delay"):
            first = c.post(
                f"/api/v1/trust/projects/{pid}/generate-book",
                json={"api_key": "sk-ant-" + "e" * 20},
            ).json()

        latest = c.get(f"/api/v1/trust/projects/{pid}/generation-jobs/latest").json()
        assert latest["id"] == first["job_id"]
