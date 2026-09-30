"""Tests for live intervention config API — GET/PATCH /api/v1/admin/analytics/intervention-config."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from fastapi import FastAPI

from backend.src.admin.config_repo import set_config


@pytest.mark.asyncio
async def test_get_intervention_config_requires_super_admin(app: FastAPI, client: AsyncClient):
    """GET should 403 for non-admin users."""
    # Without auth token, expect 403
    resp = await client.get("/api/v1/admin/analytics/intervention-config")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_intervention_config_returns_live_values(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """GET should return current intervention config."""
    resp = await client.get(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "intervention_retry_interval_days" in data
    assert "max_intervention_attempts" in data
    assert isinstance(data["intervention_retry_interval_days"], int)
    assert isinstance(data["max_intervention_attempts"], int)
    assert data["intervention_retry_interval_days"] >= 1
    assert data["max_intervention_attempts"] >= 1


@pytest.mark.asyncio
async def test_patch_intervention_config_requires_super_admin(app: FastAPI, client: AsyncClient):
    """PATCH should 403 for non-admin users."""
    resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        json={"intervention_retry_interval_days": 5},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_patch_intervention_config_updates_retry_interval(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """PATCH should update retry interval and return updated config."""
    resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"intervention_retry_interval_days": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "intervention config updated (live, no restart needed)"
    assert data["updated"]["intervention_retry_interval_days"] == 5


@pytest.mark.asyncio
async def test_patch_intervention_config_updates_max_attempts(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """PATCH should update max attempts."""
    resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"max_intervention_attempts": 4},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"]["max_intervention_attempts"] == 4


@pytest.mark.asyncio
async def test_patch_intervention_config_both_fields(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """PATCH can update both fields at once."""
    resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"intervention_retry_interval_days": 3, "max_intervention_attempts": 2},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"]["intervention_retry_interval_days"] == 3
    assert data["updated"]["max_intervention_attempts"] == 2


@pytest.mark.asyncio
async def test_patch_intervention_config_requires_at_least_one_field(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """PATCH should 400 if no fields provided."""
    resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={},
    )
    assert resp.status_code == 400
    data = resp.json()
    assert "at least one" in data["detail"].lower()


@pytest.mark.asyncio
async def test_patch_intervention_config_validates_min_values(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """PATCH should validate that values are >= 1."""
    resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"intervention_retry_interval_days": 0},  # invalid
    )
    assert resp.status_code == 422  # Pydantic validation error


@pytest.mark.asyncio
async def test_get_reflects_patch_update(
    app: FastAPI, client: AsyncClient, admin_token: str, db_pool
):
    """GET should immediately reflect PATCH changes (live update)."""
    # Update via PATCH
    update_resp = await client.patch(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"intervention_retry_interval_days": 7},
    )
    assert update_resp.status_code == 200

    # Verify via GET
    get_resp = await client.get(
        "/api/v1/admin/analytics/intervention-config",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["intervention_retry_interval_days"] == 7
