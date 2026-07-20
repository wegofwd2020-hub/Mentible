"""GET /api/v1/shelves/feed — anonymous, capped, metadata-only."""

from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from backend.main import app
from backend.src.shelves import router as shelves_router

FEED = b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>'
ATOM = "application/atom+xml;charset=utf-8"


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    # NOTE: must take no params. FastAPI (0.123) derives the request-validation
    # model for an override from the OVERRIDE's own signature when the original
    # is wired via `dependencies=[Depends(...)]` (no bound return value) — a
    # `*args, **kwargs` override gets introspected as two required query params
    # named `args`/`kwargs`, turning every call into a 422.
    async def _noop():
        return None

    app.dependency_overrides[shelves_router.enforce_feed_rate_limit] = _noop
    yield
    app.dependency_overrides.clear()


async def _call(url: str) -> httpx.Response:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.get("/api/v1/shelves/feed", params={"url": url})


@pytest.mark.asyncio
async def test_happy_path_returns_raw_xml_and_requires_no_auth(monkeypatch):
    async def fake_fetch(url, client, resolve=None):
        from backend.src.shelves.feed_fetch import FetchedFeed

        return FetchedFeed(body=FEED, content_type=ATOM)

    monkeypatch.setattr(shelves_router, "fetch_feed", fake_fetch)

    resp = await _call("https://ex.org/f.opds")  # NO Authorization header sent

    assert resp.status_code == 200
    assert resp.content == FEED  # byte-for-byte
    assert "atom" in resp.headers["content-type"]


@pytest.mark.asyncio
async def test_blocked_host_is_400(monkeypatch):
    from backend.src.shelves.url_guard import BlockedUrlError

    async def fake_fetch(url, client, resolve=None):
        raise BlockedUrlError("That host isn't allowed.", "blocked_host")

    monkeypatch.setattr(shelves_router, "fetch_feed", fake_fetch)

    resp = await _call("https://evil.example/f.opds")
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "blocked_host"


@pytest.mark.asyncio
async def test_upstream_401_is_502_with_auth_required_code(monkeypatch):
    from backend.src.shelves.feed_fetch import FeedFetchError

    async def fake_fetch(url, client, resolve=None):
        raise FeedFetchError("Authenticated repos aren't supported yet.", "auth_required", 401)

    monkeypatch.setattr(shelves_router, "fetch_feed", fake_fetch)

    resp = await _call("https://ex.org/f.opds")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "auth_required"


@pytest.mark.asyncio
async def test_too_large_is_413(monkeypatch):
    from backend.src.shelves.feed_fetch import FeedFetchError

    async def fake_fetch(url, client, resolve=None):
        raise FeedFetchError("That feed is too large to add.", "too_large")

    monkeypatch.setattr(shelves_router, "fetch_feed", fake_fetch)

    resp = await _call("https://ex.org/f.opds")
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "too_large"


@pytest.mark.asyncio
async def test_not_a_feed_is_400(monkeypatch):
    from backend.src.shelves.feed_fetch import FeedFetchError

    async def fake_fetch(url, client, resolve=None):
        raise FeedFetchError("That URL doesn't look like an OPDS catalog.", "not_a_feed")

    monkeypatch.setattr(shelves_router, "fetch_feed", fake_fetch)

    resp = await _call("https://ex.org/404.html")
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "not_a_feed"


@pytest.mark.asyncio
async def test_url_param_is_required():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/api/v1/shelves/feed")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_limiter_dependency_is_actually_wired_to_the_route():
    """The other tests in this module override `enforce_feed_rate_limit` away
    (see `_no_rate_limit` above), so deleting
    `dependencies=[Depends(enforce_feed_rate_limit)]` from the route would fail
    NONE of them. This test undoes that override for its own duration so the
    REAL limiter runs, then forces its Redis dependency to always error. The
    limiter is fail-closed (unlike /generate's), so if it's actually wired in,
    this must come back 503 with the limiter's own error code — proving the
    dependency executes per-request, not just that the route works.

    Mutation check performed manually: with
    `dependencies=[Depends(enforce_feed_rate_limit)]` temporarily deleted from
    the route in router.py, this test failed (got 200, not 503); restoring the
    dependency made it pass again.
    """
    from backend.src.core.redis_dep import get_redis as core_get_redis

    class DeadRedis:
        async def incr(self, key: str) -> int:
            raise ConnectionError("redis is down")

        async def expire(self, key: str, ttl: int) -> None:
            raise ConnectionError("redis is down")

        async def ttl(self, key: str) -> int:
            raise ConnectionError("redis is down")

    async def _dead_redis():
        return DeadRedis()

    # Let the real `enforce_feed_rate_limit` dependency run for this test only.
    app.dependency_overrides.pop(shelves_router.enforce_feed_rate_limit, None)
    app.dependency_overrides[core_get_redis] = _dead_redis
    try:
        resp = await _call("https://ex.org/f.opds")
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "unavailable"
    finally:
        app.dependency_overrides.pop(core_get_redis, None)
        # The module's autouse fixture re-applies the no-op override before
        # the NEXT test via its own setup; nothing else to restore here.
        pass
