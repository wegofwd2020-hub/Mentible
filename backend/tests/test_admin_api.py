"""Admin user-management API (ADR-020 ticket #2) end-to-end through the app,
against a real Postgres. `require_super_admin` is overridden to inject an operator
(the gate itself is unit-tested in test_super_admin); the DB + routing run for
real. A target user is provisioned via the account API (overriding
`require_active_user`). Skipped without DATABASE_URL."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.auth.deps import require_super_admin, require_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")

ADMIN = "/api/v1/admin"
ACCOUNT = "/api/v1/account"
TARGET = "admin-api-target-sub"

_ADMIN_PRINCIPAL = Principal(
    sub="admin-api-admin-sub", email="boss@x.com", issuer="https://test", is_super_admin=True
)
_TARGET_PRINCIPAL = Principal(sub=TARGET, email="target@x.com", issuer="https://test")


@pytest.fixture
def admin_client():
    """An operator client. `require_super_admin` is overridden (admin routes); the
    inner `require_user` is overridden to the *target* so the REAL `require_active_user`
    still runs its DB suspension check on the account route. Cleans up afterwards."""
    app.dependency_overrides[require_super_admin] = lambda: _ADMIN_PRINCIPAL
    app.dependency_overrides[require_user] = lambda: _TARGET_PRINCIPAL
    with TestClient(app) as c:
        c.get(ACCOUNT)  # provision the target account
        try:
            yield c
        finally:
            c.delete(f"{ADMIN}/users/{TARGET}")  # purge (idempotent enough)
    app.dependency_overrides.clear()


def test_list_includes_target(admin_client):
    r = admin_client.get(f"{ADMIN}/users")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    assert TARGET in [u["sub"] for u in body["users"]]
    # metadata only — no key material, no internal id
    sample = body["users"][0]
    assert "id" not in sample
    assert set(sample) == {"sub", "email", "created_at", "suspended", "suspended_at"}


def test_get_user_detail(admin_client):
    r = admin_client.get(f"{ADMIN}/users/{TARGET}")
    assert r.status_code == 200
    body = r.json()
    assert body["sub"] == TARGET
    assert body["suspended"] is False
    assert body["credentials"] == []


def test_get_unknown_user_404(admin_client):
    assert admin_client.get(f"{ADMIN}/users/no-such-sub").status_code == 404


def test_suspend_then_reactivate(admin_client):
    r = admin_client.post(f"{ADMIN}/users/{TARGET}/suspend")
    assert r.status_code == 200
    assert r.json()["suspended"] is True
    assert admin_client.get(f"{ADMIN}/users/{TARGET}").json()["suspended"] is True

    r = admin_client.post(f"{ADMIN}/users/{TARGET}/reactivate")
    assert r.status_code == 200
    assert r.json()["suspended"] is False


def test_suspend_blocks_the_users_own_authed_route(admin_client):
    """A suspended user is 403'd on their own account route (require_active_user)."""
    admin_client.post(f"{ADMIN}/users/{TARGET}/suspend")
    # require_active_user is overridden to the target principal but still runs the
    # real suspension check against the DB → 403.
    assert admin_client.get(ACCOUNT).status_code == 403
    admin_client.post(f"{ADMIN}/users/{TARGET}/reactivate")
    assert admin_client.get(ACCOUNT).status_code == 200


def test_suspend_unknown_user_404(admin_client):
    assert admin_client.post(f"{ADMIN}/users/ghost/suspend").status_code == 404


def test_delete_user(admin_client):
    assert admin_client.delete(f"{ADMIN}/users/{TARGET}").status_code == 204
    assert admin_client.get(f"{ADMIN}/users/{TARGET}").status_code == 404
    assert admin_client.delete(f"{ADMIN}/users/{TARGET}").status_code == 404  # already gone


def test_non_admin_forbidden():
    """An ordinary verified user (not in the allowlist) gets 403 from the gate."""
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="ordinary", email="user@x.com", issuer="https://test", is_super_admin=False
    )
    try:
        with TestClient(app) as c:
            assert c.get(f"{ADMIN}/users").status_code == 403
    finally:
        app.dependency_overrides.clear()
