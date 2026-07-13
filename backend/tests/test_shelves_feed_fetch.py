"""The feed fetcher: caps, redirect re-validation, content-type allowlist."""

from __future__ import annotations

import httpx
import pytest

from backend.src.shelves.feed_fetch import (
    MAX_FEED_BYTES,
    FeedFetchError,
    fetch_feed,
)
from backend.src.shelves.url_guard import BlockedUrlError

FEED = b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>'
ATOM = "application/atom+xml;profile=opds-catalog;charset=utf-8"


async def public(host: str) -> list[str]:
    return ["93.184.216.34"]


async def private(host: str) -> list[str]:
    return ["127.0.0.1"]


def client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_happy_path_returns_the_upstream_bytes_unchanged():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=FEED, headers={"content-type": ATOM})

    async with client_for(handler) as c:
        got = await fetch_feed("https://ex.org/f.opds", c, public)

    assert got.body == FEED  # byte-for-byte; we are a pipe, not a parser
    assert "atom" in got.content_type


@pytest.mark.asyncio
async def test_no_credentials_are_ever_forwarded_upstream():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update({k.lower(): v for k, v in request.headers.items()})
        return httpx.Response(200, content=FEED, headers={"content-type": ATOM})

    async with client_for(handler) as c:
        await fetch_feed("https://ex.org/f.opds", c, public)

    assert "authorization" not in seen
    assert "cookie" not in seen


@pytest.mark.asyncio
async def test_upstream_401_maps_to_auth_required():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    async with client_for(handler) as c:
        with pytest.raises(FeedFetchError) as exc:
            await fetch_feed("https://ex.org/f.opds", c, public)
    assert exc.value.reason == "auth_required"


@pytest.mark.asyncio
async def test_upstream_500_maps_to_upstream_error_with_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    async with client_for(handler) as c:
        with pytest.raises(FeedFetchError) as exc:
            await fetch_feed("https://ex.org/f.opds", c, public)
    assert exc.value.reason == "upstream_error"
    assert exc.value.status == 503


@pytest.mark.asyncio
async def test_html_content_type_is_rejected_not_parsed():
    """A 404-page-shaped-as-a-feed (the Feedbooks case) must never reach the parser."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<!doctype html><html>nope</html>",
                              headers={"content-type": "text/html; charset=utf-8"})

    async with client_for(handler) as c:
        with pytest.raises(FeedFetchError) as exc:
            await fetch_feed("https://ex.org/f.opds", c, public)
    assert exc.value.reason == "not_a_feed"


@pytest.mark.asyncio
async def test_oversize_body_is_aborted():
    big = b"x" * (MAX_FEED_BYTES + 1)

    def handler(request: httpx.Request) -> httpx.Response:
        # No content-length: the stream cap is the only thing standing between us and OOM.
        return httpx.Response(200, content=big, headers={"content-type": ATOM})

    async with client_for(handler) as c:
        with pytest.raises(FeedFetchError) as exc:
            await fetch_feed("https://ex.org/f.opds", c, public)
    assert exc.value.reason == "too_large"


@pytest.mark.asyncio
async def test_declared_content_length_over_cap_is_rejected_early():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"small",
            headers={"content-type": ATOM, "content-length": str(MAX_FEED_BYTES + 1)},
        )

    async with client_for(handler) as c:
        with pytest.raises(FeedFetchError) as exc:
            await fetch_feed("https://ex.org/f.opds", c, public)
    assert exc.value.reason == "too_large"


@pytest.mark.asyncio
async def test_redirect_into_private_space_is_blocked():
    """https://public/x -> 302 -> http://127.0.0.1:6379/ — the canonical SSRF bypass."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "ex.org":
            return httpx.Response(302, headers={"location": "https://internal.example/x"})
        raise AssertionError("must never connect to the redirect target")

    async def resolve(host: str) -> list[str]:
        return ["93.184.216.34"] if host == "ex.org" else ["127.0.0.1"]

    async with client_for(handler) as c:
        with pytest.raises(BlockedUrlError):
            await fetch_feed("https://ex.org/f.opds", c, resolve)


@pytest.mark.asyncio
async def test_redirect_to_plaintext_http_is_blocked():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://ex.org/f.opds"})

    async with client_for(handler) as c:
        with pytest.raises(BlockedUrlError):
            await fetch_feed("https://ex.org/f.opds", c, public)


@pytest.mark.asyncio
async def test_a_redirect_to_a_public_host_is_followed():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "ex.org":
            return httpx.Response(301, headers={"location": "https://cdn.example/f.opds"})
        return httpx.Response(200, content=FEED, headers={"content-type": ATOM})

    async with client_for(handler) as c:
        got = await fetch_feed("https://ex.org/f.opds", c, public)
    assert got.body == FEED


@pytest.mark.asyncio
async def test_redirect_loop_is_bounded():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://ex.org/again"})

    async with client_for(handler) as c:
        with pytest.raises(FeedFetchError) as exc:
            await fetch_feed("https://ex.org/f.opds", c, public)
    assert exc.value.reason == "upstream_error"
