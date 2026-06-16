"""Rate-limit tests — the fixed-window limiter on the expensive endpoints.

Unit tests cover the window counter, identity keying, and fail-open; HTTP tests
drive /generate through the real dependency to assert 202-under-limit / 429-over,
the Retry-After header, the disable switch, and per-identity bucketing.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.config import settings
from backend.src.auth.principal import Principal
from backend.src.core.rate_limit import _identity, _window_hit, enforce_rate_limit
from backend.tests.helpers import fake_provider
from backend.tests.test_generate_e2e import _FAKE_LESSON_JSON


def _body(api_key: str) -> dict:
    # Fresh request_id each call so the limiter (which runs before the idempotency
    # check) sees a distinct request every time.
    return {
        "request_id": str(uuid.uuid4()),
        "topic": "Quadratic formula",
        "level": "student",
        "language": "en",
        "format": "lesson",
        "api_key": api_key,
        "depth": "standard",
    }


# ── Unit: window counter ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_window_hit_allows_then_blocks(fake_redis):
    for _ in range(3):
        allowed, retry = await _window_hit(fake_redis, "rl:test", 3, 60)
        assert allowed and retry == 0
    allowed, retry = await _window_hit(fake_redis, "rl:test", 3, 60)
    assert not allowed
    assert retry >= 1  # Retry-After is the remaining window TTL


@pytest.mark.asyncio
async def test_window_hit_limit_zero_disables(fake_redis):
    for _ in range(50):
        allowed, _ = await _window_hit(fake_redis, "rl:zero", 0, 60)
        assert allowed


# ── Unit: identity keying ──────────────────────────────────────────────────────


def test_identity_prefers_principal_then_ip():
    req = SimpleNamespace(client=SimpleNamespace(host="9.9.9.9"))
    p = Principal(sub="user-1", email=None, issuer="iss")
    assert _identity(req, p) == "sub:user-1"
    assert _identity(req, None) == "ip:9.9.9.9"


def test_identity_handles_missing_client():
    req = SimpleNamespace(client=None)
    assert _identity(req, None) == "ip:unknown"


# ── Unit: fail-open ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fail_open_on_redis_error(monkeypatch):
    """A limiter-backend outage must not break the API — the request is allowed."""
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_per_minute", 1)

    class BadRedis:
        async def incr(self, *a, **k):
            raise RuntimeError("redis down")

    req = SimpleNamespace(client=SimpleNamespace(host="1.2.3.4"))
    # Should return None (allowed), not raise.
    assert await enforce_rate_limit(req, None, BadRedis()) is None


# ── HTTP: end-to-end through the dependency ────────────────────────────────────


@pytest.mark.asyncio
async def test_per_minute_limit_returns_429(client, fake_redis, known_test_api_key, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    monkeypatch.setattr(settings, "rate_limit_per_day", 1000)

    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_FAKE_LESSON_JSON),
    ):
        codes = [
            (await client.post("/api/v1/generate", json=_body(known_test_api_key))).status_code
            for _ in range(5)
        ]
        blocked = await client.post("/api/v1/generate", json=_body(known_test_api_key))

    assert codes[:3] == [202, 202, 202]
    assert codes[3] == 429 and codes[4] == 429
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1


@pytest.mark.asyncio
async def test_disabled_switch_allows_all(client, fake_redis, known_test_api_key, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_FAKE_LESSON_JSON),
    ):
        for _ in range(8):
            r = await client.post("/api/v1/generate", json=_body(known_test_api_key))
            assert r.status_code == 202


@pytest.mark.asyncio
async def test_authed_and_anon_have_separate_buckets(
    client, fake_redis, known_test_api_key, monkeypatch
):
    from backend.main import app
    from backend.src.auth.deps import optional_user

    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    monkeypatch.setattr(settings, "rate_limit_per_day", 1000)

    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_FAKE_LESSON_JSON),
    ):
        # Anonymous (ip:testclient) — exhaust the bucket.
        for _ in range(2):
            assert (
                await client.post("/api/v1/generate", json=_body(known_test_api_key))
            ).status_code == 202
        assert (
            await client.post("/api/v1/generate", json=_body(known_test_api_key))
        ).status_code == 429

        # An authenticated principal keys on sub — a fresh, separate bucket.
        app.dependency_overrides[optional_user] = lambda: Principal(
            sub="user-1", email=None, issuer="iss"
        )
        try:
            for _ in range(2):
                assert (
                    await client.post("/api/v1/generate", json=_body(known_test_api_key))
                ).status_code == 202
            assert (
                await client.post("/api/v1/generate", json=_body(known_test_api_key))
            ).status_code == 429
        finally:
            app.dependency_overrides.pop(optional_user, None)
