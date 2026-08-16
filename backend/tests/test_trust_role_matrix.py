"""Reviewer/editor permission matrix (P0-2 slice C).

Editor: may create/edit content (create-version) and comment; may NOT approve.
Reviewer: may approve/withdraw and comment; may NOT create/edit content.
Owner: may do everything.
Invite: role="editor" is stored; an unknown role is rejected with 422.
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


def _setup(c):
    """Owner creates a project + one artifact version, then invites one
    editor and one reviewer. Returns (owner_sub, project_id, artifact_id,
    version_id, editor_email, reviewer_email)."""
    owner = f"o-{uuid.uuid4()}"
    editor_email = f"ed-{uuid.uuid4()}@x.z"
    reviewer_email = f"rv-{uuid.uuid4()}@x.z"
    _as(owner, f"{owner}@x.z")
    pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
    art = c.post(
        f"/api/v1/trust/projects/{pid}/artifacts",
        json={"role": "cornerstone", "format": "book"},
    ).json()
    vid = c.post(
        f"/api/v1/trust/artifacts/{art['id']}/versions",
        json={"content": {"sections": []}},
    ).json()["id"]
    inv_e = c.post(
        f"/api/v1/trust/projects/{pid}/invitations",
        json={"email": editor_email, "role": "editor"},
    ).json()
    assert inv_e["role"] == "editor"
    inv_r = c.post(
        f"/api/v1/trust/projects/{pid}/invitations",
        json={"email": reviewer_email, "role": "reviewer"},
    ).json()
    assert inv_r["role"] == "reviewer"
    return owner, pid, art["id"], vid, editor_email, reviewer_email


def _redeem(c, email):
    _as(f"u-{uuid.uuid4()}", email)
    c.post("/api/v1/trust/session/sync")


def test_editor_200_create_version_403_approve_200_comment_200_read():
    with TestClient(app) as c:
        _owner, _pid, artifact_id, vid, editor_email, _reviewer_email = _setup(c)
        _redeem(c, editor_email)

        r = c.post(
            f"/api/v1/trust/artifacts/{artifact_id}/versions",
            json={"content": {"sections": []}},
        )
        assert r.status_code == 200, r.text

        r = c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z"},
        )
        assert r.status_code == 403, r.text

        r = c.post(f"/api/v1/trust/versions/{vid}/feedback", json={"body": "looks good"})
        assert r.status_code == 200, r.text

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200, r.text


def test_reviewer_403_create_version_200_approve_200_comment_200_read():
    with TestClient(app) as c:
        _owner, _pid, artifact_id, vid, _editor_email, reviewer_email = _setup(c)
        _redeem(c, reviewer_email)

        r = c.post(
            f"/api/v1/trust/artifacts/{artifact_id}/versions",
            json={"content": {"sections": []}},
        )
        assert r.status_code == 403, r.text

        r = c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z"},
        )
        assert r.status_code == 200, r.text

        r = c.post(f"/api/v1/trust/versions/{vid}/feedback", json={"body": "revise section 2"})
        assert r.status_code == 200, r.text

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200, r.text


def test_owner_200_on_all():
    with TestClient(app) as c:
        owner, _pid, artifact_id, _vid, _editor_email, _reviewer_email = _setup(c)
        _as(owner, f"{owner}@x.z")

        r = c.post(
            f"/api/v1/trust/artifacts/{artifact_id}/versions",
            json={"content": {"sections": []}},
        )
        assert r.status_code == 200, r.text
        vid2 = r.json()["id"]

        r = c.post(
            f"/api/v1/trust/versions/{vid2}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr Owner"},
        )
        assert r.status_code == 200, r.text

        r = c.post(f"/api/v1/trust/versions/{vid2}/feedback", json={"body": "note"})
        assert r.status_code == 200, r.text

        r = c.get(f"/api/v1/trust/versions/{vid2}")
        assert r.status_code == 200, r.text


def test_invite_editor_role_stored_and_bogus_role_rejected():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]

        good = c.post(
            f"/api/v1/trust/projects/{pid}/invitations",
            json={"email": f"e-{uuid.uuid4()}@x.z", "role": "editor"},
        )
        assert good.status_code == 200, good.text
        assert good.json()["role"] == "editor"

        bad = c.post(
            f"/api/v1/trust/projects/{pid}/invitations",
            json={"email": f"b-{uuid.uuid4()}@x.z", "role": "bogus"},
        )
        assert bad.status_code == 422, bad.text
