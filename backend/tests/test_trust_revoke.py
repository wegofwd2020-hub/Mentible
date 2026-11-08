"""Owner revoke of an expert invite (DELETE /projects/{id}/invitations?email=).

Revoke must do both halves: stop future redeems (invite revoked_at) and cut
access the expert already has (membership deleted). Owner-only.

Accounts are keyed on the IdP subject, so each test uses ONE stable expert sub.
Re-using a fresh sub would create a different account and prove nothing.
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


def _owner_project(c):
    owner = f"o-{uuid.uuid4()}"
    _as(owner, f"{owner}@x.z")
    pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
    return owner, pid


def _invite(c, pid, email, role="reviewer"):
    r = c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": email, "role": role})
    assert r.status_code == 200, r.text


def _expert(email):
    """One stable expert identity for the whole test."""
    return f"rv-{uuid.uuid4()}", email


def _sync(c, expert):
    _as(*expert)
    return c.post("/api/v1/trust/session/sync").json()


def _revoke(c, pid, email):
    return c.delete(f"/api/v1/trust/projects/{pid}/invitations", params={"email": email})


def test_revoke_cuts_existing_reviewer_access():
    with TestClient(app) as c:
        owner, pid = _owner_project(c)
        email = f"rv-{uuid.uuid4()}@x.z"
        expert = _expert(email)
        _invite(c, pid, email)
        assert len(_sync(c, expert)["memberships"]) == 1
        _as(*expert)
        assert c.get(f"/api/v1/trust/projects/{pid}").status_code == 200

        _as(owner, f"{owner}@x.z")
        assert _revoke(c, pid, email).status_code == 204

        # Same expert, next request: access is gone without re-login.
        _as(*expert)
        assert c.get(f"/api/v1/trust/projects/{pid}").status_code == 403


def test_revoked_invite_does_not_redeem_on_later_sync():
    with TestClient(app) as c:
        owner, pid = _owner_project(c)
        email = f"rv-{uuid.uuid4()}@x.z"
        expert = _expert(email)
        _invite(c, pid, email)

        _as(owner, f"{owner}@x.z")
        assert _revoke(c, pid, email).status_code == 204  # revoked before any sync

        assert _sync(c, expert)["memberships"] == []


def test_reinvite_restores_access_after_revoke():
    with TestClient(app) as c:
        owner, pid = _owner_project(c)
        email = f"rv-{uuid.uuid4()}@x.z"
        expert = _expert(email)
        _invite(c, pid, email)
        _as(owner, f"{owner}@x.z")
        assert _revoke(c, pid, email).status_code == 204

        _invite(c, pid, email)  # re-invite un-revokes the same row
        assert len(_sync(c, expert)["memberships"]) == 1


def test_revoke_is_owner_only():
    with TestClient(app) as c:
        _, pid = _owner_project(c)
        email = f"rv-{uuid.uuid4()}@x.z"
        expert = _expert(email)
        _invite(c, pid, email)
        _sync(c, expert)  # now a reviewer on the project

        _as(*expert)
        assert _revoke(c, pid, email).status_code == 403


def test_revoke_unknown_email_is_404():
    with TestClient(app) as c:
        owner, pid = _owner_project(c)
        _as(owner, f"{owner}@x.z")
        assert _revoke(c, pid, f"nobody-{uuid.uuid4()}@x.z").status_code == 404


def test_revoke_is_case_insensitive():
    with TestClient(app) as c:
        owner, pid = _owner_project(c)
        email = f"rv-{uuid.uuid4()}@x.z"
        expert = _expert(email)
        _invite(c, pid, email)
        _sync(c, expert)

        _as(owner, f"{owner}@x.z")
        assert _revoke(c, pid, email.upper()).status_code == 204
        _as(*expert)
        assert c.get(f"/api/v1/trust/projects/{pid}").status_code == 403
