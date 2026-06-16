"""Shared Redis dependency.

Lives in `core` (not in a router) so cross-cutting concerns like rate limiting
can depend on the SAME `get_redis` callable the routers and the tests override,
without importing a router (which would create an import cycle).

Tests override this exact callable via `app.dependency_overrides[get_redis]`
(see conftest), so it must be defined in exactly one place and imported
everywhere else.
"""

from __future__ import annotations

import redis.asyncio as redis

from backend.config import settings


async def get_redis() -> redis.Redis:
    """Return a Redis client. In production this is overridden by the
    lifespan-managed pool; the default is fine for local dev and tests
    that fall through to a real fakeredis-backed client."""
    return redis.from_url(settings.redis_url, decode_responses=False)
