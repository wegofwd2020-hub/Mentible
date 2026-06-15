"""Pytest configuration for the StudyBuddy Q backend.

Provides:
- A test BYOK master key (deterministic so envelope tests are reproducible).
- A fakeredis-backed Redis client.
- An ASGI test client wired with both.
"""

from __future__ import annotations

import os

import fakeredis.aioredis
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Provide a deterministic master key for tests BEFORE importing config.
# Real deployments load BYOK_MASTER_KEY from env; tests fix it here.
os.environ.setdefault("BYOK_MASTER_KEY", "0" * 64)
# System-owner secret (ADR-018) — required at startup like the master key; tests
# fix a deterministic value here before config.Settings() runs.
os.environ.setdefault("SYSTEM_OWNER_SECRET", "1" * 64)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("LOG_LEVEL", "INFO")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")


@pytest_asyncio.fixture
async def fake_redis():
    """An isolated fakeredis client per test."""
    r = fakeredis.aioredis.FakeRedis(decode_responses=False)
    try:
        yield r
    finally:
        await r.aclose()


@pytest_asyncio.fixture
async def client(fake_redis):
    """ASGI test client with /generate's Redis dependency overridden to fakeredis."""
    # Importing here ensures env vars above are set before config.Settings() runs.
    from backend.main import app
    from backend.src.generate.router import get_redis

    async def _override_redis():
        return fake_redis

    app.dependency_overrides[get_redis] = _override_redis
    app.state.redis = fake_redis

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def known_test_api_key() -> str:
    """A fake but plausibly-shaped Anthropic key used by leak tests.

    NOT a real key. The string starts with `sk-ant-` so the redaction
    pattern catches it. Any test that exercises the request path with an
    api_key MUST use this fixture so the leak-detection assertion has a
    consistent target.
    """
    return "sk-ant-TEST_FAKE_KEY_for_leak_detection_DO_NOT_REPLACE_with_a_real_key_xxxxxxxx"


@pytest.fixture
def known_test_openai_key() -> str:
    """A fake but plausibly-shaped OpenAI-compatible key (sk-, NOT sk-ant-).

    NOT a real key. Used by multi-provider leak tests to assert the generic
    `sk-…` redaction backstop catches non-Anthropic key formats too.
    """
    return "sk-TEST_FAKE_OPENAI_KEY_for_leak_detection_DO_NOT_REPLACE_xxxxxxxxxxxxxxxx"
