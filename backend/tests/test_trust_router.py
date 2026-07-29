import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal

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


def test_session_sync_no_email_no_memberships():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", None)
        body = c.post("/api/v1/trust/session/sync").json()
        assert body["memberships"] == []


def test_session_sync_fresh_account_returns_account_and_empty():
    with TestClient(app) as c:
        email = f"u-{uuid.uuid4()}@x.z"
        _as(f"u-{uuid.uuid4()}", email)
        body = c.post("/api/v1/trust/session/sync").json()
        assert body["email"] == email
        assert body["account_id"]  # account resolved/created
        assert body["memberships"] == []  # no invites for this fresh email
        # idempotent
        assert c.post("/api/v1/trust/session/sync").json()["memberships"] == []


def test_owner_authoring_chain_and_non_owner_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "Guide", "topic": "t"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        assert art["role"] == "cornerstone"
        ver = c.post(
            f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {"t": "a"}}
        ).json()
        assert ver["version_no"] == 1
        # a different account is not the owner → 403 on artifact create
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "derivative", "format": "linkedin"},
        )
        assert r.status_code == 403


def test_bad_enum_422_and_unknown_artifact_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts", json={"role": "bogus", "format": "book"}
        )
        assert r.status_code == 422
        r2 = c.post(f"/api/v1/trust/artifacts/{uuid.uuid4()}/versions", json={"content": {}})
        assert r2.status_code == 404
