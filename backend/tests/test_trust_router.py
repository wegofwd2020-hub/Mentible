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
