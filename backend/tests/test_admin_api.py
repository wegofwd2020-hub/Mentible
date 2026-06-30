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
    assert set(sample) == {
        "sub",
        "email",
        "created_at",
        "suspended",
        "suspended_at",
        "device_count",
    }


def test_get_user_detail(admin_client):
    r = admin_client.get(f"{ADMIN}/users/{TARGET}")
    assert r.status_code == 200
    body = r.json()
    assert body["sub"] == TARGET
    assert body["suspended"] is False
    assert body["credentials"] == []
    assert body["device_count"] == 0
    assert body["devices"] == []


def test_device_register_shows_in_admin_view(admin_client):
    """A device the user reports surfaces as a count in the list + a row in detail.
    Re-reporting the same device_id is a heartbeat (still one device)."""
    body = {"device_id": "dev-abc", "label": "Pixel 7", "platform": "android"}
    assert admin_client.post(f"{ACCOUNT}/devices", json=body).status_code == 204
    assert admin_client.post(f"{ACCOUNT}/devices", json=body).status_code == 204  # heartbeat

    row = next(u for u in admin_client.get(f"{ADMIN}/users").json()["users"] if u["sub"] == TARGET)
    assert row["device_count"] == 1

    detail = admin_client.get(f"{ADMIN}/users/{TARGET}").json()
    assert detail["device_count"] == 1
    assert [d["device_id"] for d in detail["devices"]] == ["dev-abc"]
    assert detail["devices"][0]["label"] == "Pixel 7"


def test_devices_cascade_on_account_delete(admin_client):
    admin_client.post(f"{ACCOUNT}/devices", json={"device_id": "dev-xyz"})
    assert admin_client.delete(f"{ADMIN}/users/{TARGET}").status_code == 204
    # Re-provision the same sub: the prior device must be gone (cascaded).
    admin_client.get(ACCOUNT)
    assert admin_client.get(f"{ADMIN}/users/{TARGET}").json()["devices"] == []


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


def test_actions_are_audited(admin_client):
    admin_client.post(f"{ADMIN}/users/{TARGET}/suspend")
    admin_client.post(f"{ADMIN}/users/{TARGET}/reactivate")
    r = admin_client.get(f"{ADMIN}/audit")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 2
    recent = [(e["action"], e["target_sub"], e["actor_sub"]) for e in body["entries"]]
    assert ("user.suspend", TARGET, _ADMIN_PRINCIPAL.sub) in recent
    assert ("user.reactivate", TARGET, _ADMIN_PRINCIPAL.sub) in recent
    # never any secret in the trail
    assert all("secret" not in str(e).lower() for e in body["entries"])


def test_delete_audit_outlives_the_account(admin_client):
    admin_client.delete(f"{ADMIN}/users/{TARGET}")
    # account is gone…
    assert admin_client.get(f"{ADMIN}/users/{TARGET}").status_code == 404
    # …but the delete is still attributable in the trail.
    entries = admin_client.get(f"{ADMIN}/audit").json()["entries"]
    assert ("user.delete", TARGET) in [(e["action"], e["target_sub"]) for e in entries]


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


# ── Managed entitlement (ADR-005 D6, Phase 3) ──────────────────────────────────


def test_entitlement_absent_then_granted(admin_client):
    # Fresh target has no entitlement → null.
    assert admin_client.get(f"{ADMIN}/users/{TARGET}/entitlement").json() is None
    # Grant managed_basic.
    r = admin_client.put(f"{ADMIN}/users/{TARGET}/entitlement", json={"plan_id": "managed_basic"})
    assert r.status_code == 200
    body = r.json()
    assert body["plan_id"] == "managed_basic"
    assert body["status"] == "active"
    # Now readable.
    got = admin_client.get(f"{ADMIN}/users/{TARGET}/entitlement").json()
    assert got["plan_id"] == "managed_basic"
    # And audited.
    actions = [
        (e["action"], e["target_sub"]) for e in admin_client.get(f"{ADMIN}/audit").json()["entries"]
    ]
    assert ("entitlement.set:managed_basic:active", TARGET) in actions


def test_grant_replaces_existing_entitlement(admin_client):
    admin_client.put(f"{ADMIN}/users/{TARGET}/entitlement", json={"plan_id": "managed_basic"})
    r = admin_client.put(
        f"{ADMIN}/users/{TARGET}/entitlement",
        json={"plan_id": "managed_unlimited", "status": "canceled"},
    )
    assert r.status_code == 200
    got = admin_client.get(f"{ADMIN}/users/{TARGET}/entitlement").json()
    assert got["plan_id"] == "managed_unlimited"
    assert got["status"] == "canceled"


def test_grant_unknown_plan_422(admin_client):
    r = admin_client.put(f"{ADMIN}/users/{TARGET}/entitlement", json={"plan_id": "no-such-plan"})
    assert r.status_code == 422


def test_grant_unknown_user_404(admin_client):
    r = admin_client.put(
        f"{ADMIN}/users/no-such-sub/entitlement", json={"plan_id": "managed_basic"}
    )
    assert r.status_code == 404
