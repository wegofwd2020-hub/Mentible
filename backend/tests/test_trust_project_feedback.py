"""GET /projects/{id}/feedback — project-wide revision-notes rollup.

Aggregates `feedback` (artifact-version notes) and `topic_feedback`
(topic-version notes) into one read-only, owner-OR-reviewer view. Mirrors the
TestClient + `_as` auth-override pattern from `test_trust_router.py`, and
reuses its TOC/topic-version helpers rather than re-deriving them.
"""

import os
import uuid

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.redis_dep import get_redis
from backend.tests.test_trust_router import (
    _project_with_toc_topic,
    _topic_version_id,
)

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


def test_project_feedback_empty_project_returns_empty_list():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        r = c.get(f"/api/v1/trust/projects/{pid}/feedback")
        assert r.status_code == 200
        assert r.json() == []


def test_project_feedback_aggregates_artifact_and_topic_notes():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        owner_email = f"{owner}@x.z"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, owner_email)

        # a topic (from a TOC) with a generated version
        pid, _iid = _project_with_toc_topic(c, topic_id="t1")
        tvid = _topic_version_id(c, pid, topic_id="t1")

        # an artifact + version in the same project
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}}).json()[
            "id"
        ]

        # owner note on the artifact version -> operator
        af = c.post(
            f"/api/v1/trust/versions/{vid}/feedback", json={"body": "tighten the intro"}
        ).json()
        assert af["author_kind"] == "operator"

        # owner note on the topic version -> operator
        tf = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/feedback", json={"body": "add a citation"}
        ).json()
        assert tf["author_kind"] == "operator"

        body = c.get(f"/api/v1/trust/projects/{pid}/feedback").json()
        assert len(body) == 2

        # newest-first: created_at is non-increasing across the whole response
        created_ats = [item["created_at"] for item in body]
        assert created_ats == sorted(created_ats, reverse=True)

        by_source = {item["source"]: item for item in body}
        assert set(by_source) == {"artifact", "topic"}

        art_item = by_source["artifact"]
        assert art_item["draft_label"] == "book"  # no title -> COALESCE to format
        assert art_item["format"] == "book"
        assert art_item["version_no"] == 1
        assert art_item["author_kind"] == "operator"
        assert art_item["body"] == "tighten the intro"

        topic_item = by_source["topic"]
        assert topic_item["draft_label"] == "Reading music"  # topic title
        assert topic_item["format"] is None
        assert topic_item["version_no"] == 1
        assert topic_item["author_kind"] == "operator"
        assert topic_item["body"] == "add a citation"

        # a reviewer (invited + redeemed) can read the same rollup
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")  # redeem invite -> membership
        rr = c.get(f"/api/v1/trust/projects/{pid}/feedback")
        assert rr.status_code == 200
        assert len(rr.json()) == 2

        # a non-member is forbidden
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        r = c.get(f"/api/v1/trust/projects/{pid}/feedback")
        assert r.status_code == 403


def test_project_feedback_isolated_across_projects():
    """Two projects (A, B) owned by the same account each get a feedback note
    on a draft. The rollup is scoped by `project_id` in the UNION's WHERE
    clause (`feedback_repo.list_project_feedback`) — a future edit to that
    clause could silently leak one project's notes into another, so pin the
    boundary directly: A's GET must never surface B's note, and vice versa."""
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")

        def _artifact_feedback_note(pid, body):
            art = c.post(
                f"/api/v1/trust/projects/{pid}/artifacts",
                json={"role": "cornerstone", "format": "book"},
            ).json()
            vid = c.post(
                f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}}
            ).json()["id"]
            r = c.post(f"/api/v1/trust/versions/{vid}/feedback", json={"body": body})
            assert r.status_code == 200, r.text

        pid_a = c.post("/api/v1/trust/projects", json={"title": "Project A"}).json()["id"]
        pid_b = c.post("/api/v1/trust/projects", json={"title": "Project B"}).json()["id"]

        note_a = "PROJECT-A-ONLY: fix the citation on page 3"
        note_b = "PROJECT-B-ONLY: reword the closing paragraph"
        _artifact_feedback_note(pid_a, note_a)
        _artifact_feedback_note(pid_b, note_b)

        body_a = c.get(f"/api/v1/trust/projects/{pid_a}/feedback").json()
        assert len(body_a) == 1
        assert body_a[0]["body"] == note_a
        assert all(item["body"] != note_b for item in body_a)

        body_b = c.get(f"/api/v1/trust/projects/{pid_b}/feedback").json()
        assert len(body_b) == 1
        assert body_b[0]["body"] == note_b
        assert all(item["body"] != note_a for item in body_b)


def test_project_feedback_unknown_project_403():
    """No membership row exists for a random project id -> 403, not 404
    (matches `_require_role`'s no-access branch for every other trust route)."""
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"u-{uuid.uuid4()}@x.z")
        r = c.get(f"/api/v1/trust/projects/{uuid.uuid4()}/feedback")
        assert r.status_code == 403
