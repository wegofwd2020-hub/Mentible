"""The feed limiter must FAIL CLOSED — unlike the fail-open limiter on /generate."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.config import settings
from backend.src.core.rate_limit import enforce_feed_rate_limit


class FakeRequest:
    def __init__(self, host: str = "1.2.3.4") -> None:
        self.client = type("C", (), {"host": host})()


class FakeRedis:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, ttl: int) -> None:
        return None

    async def ttl(self, key: str) -> int:
        return 42


class DeadRedis:
    async def incr(self, key: str) -> int:
        raise ConnectionError("redis is down")

    async def expire(self, key: str, ttl: int) -> None:
        raise ConnectionError("redis is down")

    async def ttl(self, key: str) -> int:
        raise ConnectionError("redis is down")


@pytest.mark.asyncio
async def test_allows_under_the_limit():
    r = FakeRedis()
    for _ in range(settings.feed_fetch_per_minute):
        await enforce_feed_rate_limit(FakeRequest(), r)  # must not raise


@pytest.mark.asyncio
async def test_429_over_the_limit():
    r = FakeRedis()
    for _ in range(settings.feed_fetch_per_minute):
        await enforce_feed_rate_limit(FakeRequest(), r)
    with pytest.raises(HTTPException) as exc:
        await enforce_feed_rate_limit(FakeRequest(), r)
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_redis_down_FAILS_CLOSED_with_503():
    """The whole point: a limiter outage must NOT yield an unlimited open fetcher."""
    with pytest.raises(HTTPException) as exc:
        await enforce_feed_rate_limit(FakeRequest(), DeadRedis())
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_limits_are_per_ip():
    r = FakeRedis()
    for _ in range(settings.feed_fetch_per_minute):
        await enforce_feed_rate_limit(FakeRequest("1.1.1.1"), r)
    # A different IP still has its own budget.
    await enforce_feed_rate_limit(FakeRequest("2.2.2.2"), r)
