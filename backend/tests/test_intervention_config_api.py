"""Tests for live intervention config API — GET/PATCH /api/v1/admin/analytics/intervention-config.

Same shape as test_admin_api.py: `require_super_admin` is overridden to inject an
operator principal, and the real DB-backed config store runs underneath. The
unauthenticated cases run without the override so the real gate is exercised.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.auth.deps import require_super_admin
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")

ENDPOINT = "/api/v1/admin/analytics/intervention-config"

_ADMIN_PRINCIPAL = Principal(
    sub="intervention-config-admin", email="boss@x.com", issuer="https://test", is_super_admin=True
)


@pytest.fixture
def admin_client():
    """A client whose requests are authenticated as a super-admin operator."""
    app.dependency_overrides[require_super_admin] = lambda: _ADMIN_PRINCIPAL
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def anon_client():
    """A client with no auth override — the real super-admin gate runs."""
    app.dependency_overrides.clear()
    with TestClient(app) as c:
        yield c


def test_get_intervention_config_requires_super_admin(anon_client):
    """GET should refuse callers with no operator credential."""
    resp = anon_client.get(ENDPOINT)
    assert resp.status_code in (401, 403)


def test_get_intervention_config_returns_live_values(admin_client):
    """GET should return the current intervention config."""
    resp = admin_client.get(ENDPOINT)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["intervention_retry_interval_days"], int)
    assert isinstance(data["max_intervention_attempts"], int)
    assert data["intervention_retry_interval_days"] >= 1
    assert data["max_intervention_attempts"] >= 1


def test_patch_intervention_config_requires_super_admin(anon_client):
    """PATCH should refuse callers with no operator credential."""
    resp = anon_client.patch(ENDPOINT, json={"intervention_retry_interval_days": 5})
    assert resp.status_code in (401, 403)


def test_patch_intervention_config_updates_retry_interval(admin_client):
    """PATCH should update the retry interval and return the updated value."""
    resp = admin_client.patch(ENDPOINT, json={"intervention_retry_interval_days": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "intervention config updated (live, no restart needed)"
    assert data["updated"]["intervention_retry_interval_days"] == 5


def test_patch_intervention_config_updates_max_attempts(admin_client):
    """PATCH should update max attempts."""
    resp = admin_client.patch(ENDPOINT, json={"max_intervention_attempts": 4})
    assert resp.status_code == 200
    assert resp.json()["updated"]["max_intervention_attempts"] == 4


def test_patch_intervention_config_both_fields(admin_client):
    """PATCH can update both fields at once."""
    resp = admin_client.patch(
        ENDPOINT,
        json={"intervention_retry_interval_days": 3, "max_intervention_attempts": 2},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"]["intervention_retry_interval_days"] == 3
    assert data["updated"]["max_intervention_attempts"] == 2


def test_patch_intervention_config_requires_at_least_one_field(admin_client):
    """PATCH should 400 when no fields are provided."""
    resp = admin_client.patch(ENDPOINT, json={})
    assert resp.status_code == 400
    assert "at least one" in resp.json()["detail"].lower()


def test_patch_intervention_config_validates_min_values(admin_client):
    """PATCH should reject values below 1 with a validation error."""
    resp = admin_client.patch(ENDPOINT, json={"intervention_retry_interval_days": 0})
    assert resp.status_code == 422


def test_get_reflects_patch_update(admin_client):
    """GET should immediately reflect a PATCH (live update, no restart)."""
    update_resp = admin_client.patch(ENDPOINT, json={"intervention_retry_interval_days": 7})
    assert update_resp.status_code == 200

    get_resp = admin_client.get(ENDPOINT)
    assert get_resp.status_code == 200
    assert get_resp.json()["intervention_retry_interval_days"] == 7
