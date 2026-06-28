"""identity_admin (ADR-022) — Supabase auth-user deletion.

No DB and no network: the httpx client is faked. Covers the opt-in gate (no-op
when the service-role key is unset), the Auth Admin call shape, the idempotent
404, error propagation, and URL derivation from the issuer.
"""

from __future__ import annotations

from typing import ClassVar

import httpx
import pytest

from backend.config import settings
from backend.src.auth import identity_admin


class _FakeResp:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        self.request = httpx.Request("DELETE", "https://x/auth/v1/admin/users/s")


class _FakeClient:
    """Captures the single delete() call and returns a preset status code."""

    status: ClassVar[int] = 204
    last: ClassVar[dict] = {}

    def __init__(self, *a, **k) -> None:
        pass

    async def __aenter__(self) -> _FakeClient:
        return self

    async def __aexit__(self, *a) -> bool:
        return False

    async def delete(self, url, headers=None):
        _FakeClient.last = {"url": url, "headers": headers or {}}
        return _FakeResp(_FakeClient.status)


@pytest.fixture
def enabled(monkeypatch):
    """Identity deletion turned on, with the HTTP client faked."""
    monkeypatch.setattr(settings, "supabase_service_role_key", "svc-secret")
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co")
    monkeypatch.setattr(identity_admin.httpx, "AsyncClient", _FakeClient)
    _FakeClient.last = {}


async def test_disabled_is_noop(monkeypatch):
    # No service-role key ⇒ deletion disabled ⇒ no-op, no HTTP call, returns False.
    monkeypatch.setattr(settings, "supabase_service_role_key", "")
    assert identity_admin.identity_deletion_enabled() is False
    assert await identity_admin.delete_identity("sub-1") is False


async def test_enabled_calls_admin_api(enabled):
    _FakeClient.status = 204
    assert await identity_admin.delete_identity("sub-1") is True
    assert _FakeClient.last["url"] == "https://proj.supabase.co/auth/v1/admin/users/sub-1"
    # Both auth headers carry the service-role key (and nothing logs it).
    assert _FakeClient.last["headers"]["apikey"] == "svc-secret"
    assert _FakeClient.last["headers"]["Authorization"] == "Bearer svc-secret"


async def test_404_is_idempotent_success(enabled):
    # Already gone ⇒ treated as success, so a re-run / stale sub doesn't error.
    _FakeClient.status = 404
    assert await identity_admin.delete_identity("already-gone") is True


async def test_error_status_raises(enabled):
    # A real failure (configured but the Admin API rejected) must surface, not be
    # swallowed — the caller deletes identity-first so nothing is half-deleted.
    _FakeClient.status = 500
    with pytest.raises(httpx.HTTPStatusError):
        await identity_admin.delete_identity("sub-1")


def test_resolved_supabase_url_derives_from_issuer(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "oidc_issuer", "https://proj.supabase.co/auth/v1")
    assert settings.resolved_supabase_url == "https://proj.supabase.co"
