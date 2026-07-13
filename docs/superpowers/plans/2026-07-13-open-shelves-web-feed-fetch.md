# Open Shelves — Web Feed Fetch (CORS escape hatch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Open Shelves work in the browser by letting the backend fetch OPDS **feed metadata** on web's behalf (browsers block the direct cross-origin fetch — OPDS feeds send no CORS headers), while book **files** still download source → device.

**Architecture:** A new `backend/src/shelves/` module exposes `GET /api/v1/shelves/feed?url=…` — a dumb, capped, stateless pipe that returns the upstream feed bytes **unchanged**. It parses nothing and stores nothing, so the existing hardened client parser stays the single place hostile feed XML is handled. Mobile gains a one-function `feedTransport` seam that swaps only the *request URL* (native → direct, web → proxied); `fetchFeed`'s body is otherwise unchanged. The endpoint is anonymous, so its abuse control is a **fail-closed** rate limiter and a **resolve-then-check** SSRF guard.

**Tech Stack:** FastAPI · `httpx.AsyncClient` · `redis.asyncio` · pytest (mocked transport, no live network) · React Native/Expo · jest. Branch: `feat/open-shelves` (localhost-only; never deployed).

Spec: `docs/superpowers/specs/2026-07-13-open-shelves-web-feed-fetch-design.md`

## Global Constraints

- **The line: metadata-fetch ≠ content-proxy.** The server may fetch a *feed document*. It must **never** fetch, host, mirror, cache, or relay a *book file*. No task in this plan may add a route that returns book bytes.
- **No caching, no storage. Stateless** (spec W4). Do not add a Redis cache, an ETag store, or a DB table. The only Redis use is the rate-limit counter.
- **Return raw bytes, unparsed** (spec W3). Never add an OPDS parser to the backend — the client parser (`mobile/src/openshelves/opds12.ts`, XXE off, caps, `sanitize.ts`) stays the one hostile-XML boundary.
- **Anonymous** (spec W2). The endpoint takes **no** auth dependency — no `require_user`. Open Shelves is deliberately account-free.
- **Never forward credentials upstream.** No client cookies, no `Authorization` header, no auth of any kind reaches the third-party feed host.
- **Caps, copied verbatim from the client:** `MAX_FEED_BYTES = 8 * 1024 * 1024` (8 MiB), upstream timeout 10s, max 3 redirect hops.
- **Backend layer rule:** `backend/src/shelves/ → backend/src/core/` only. No imports from `generate/`, `billing/`, `library/`.
- **No live network in CI, either side.** Backend tests inject a mock transport and a mock resolver; mobile tests inject `fetchImpl`.
- Backend commands run from the repo root (`pytest backend/tests/...`); mobile commands run from `mobile/`.

---

### Task 1: SSRF URL guard (pure, injectable resolver)

**Files:**
- Create: `backend/src/shelves/__init__.py` (empty)
- Create: `backend/src/shelves/url_guard.py`
- Test: `backend/tests/test_shelves_url_guard.py`

**Interfaces:**
- Produces:
  - `class BlockedUrlError(ValueError)` — raised for any URL the server refuses to fetch. Carries `.reason: str`, one of `"invalid_url" | "not_https" | "blocked_host"`.
  - `Resolver = Callable[[str], Awaitable[list[str]]]` — resolves a hostname to a list of IP strings. Injected so tests never touch DNS.
  - `async def assert_fetchable(url: str, resolve: Resolver) -> str` — validates scheme + host, resolves the hostname, and raises `BlockedUrlError` if **any** resolved address is loopback/private/link-local/unique-local. Returns the URL unchanged on success.
  - `async def default_resolver(host: str) -> list[str]` — real DNS via `asyncio.get_running_loop().getaddrinfo`.

**Why this guard is the load-bearing one:** the client's equivalent (`mobile/src/openshelves/fetchFeed.ts`) can only reject *literal* private IPs — browser `fetch` never reveals what a hostname resolved to, and its comment says so. Server-side we can see the resolved address, so we must check it. On a phone an SSRF reaches the user's own LAN; on our VPS it reaches our internal network and `169.254.169.254`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_shelves_url_guard.py
"""SSRF guard for the anonymous feed-fetch endpoint."""

from __future__ import annotations

import pytest

from backend.src.shelves.url_guard import BlockedUrlError, assert_fetchable


def resolver_returning(*ips: str):
    async def _resolve(host: str) -> list[str]:
        return list(ips)

    return _resolve


PUBLIC = resolver_returning("93.184.216.34")


@pytest.mark.asyncio
async def test_public_https_url_is_allowed():
    url = "https://m.gutenberg.org/ebooks/2701.opds"
    assert await assert_fetchable(url, PUBLIC) == url


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://m.gutenberg.org/f.opds",  # plaintext
        "file:///etc/passwd",
        "gopher://example.org/",
        "not a url",
        "",
    ],
)
async def test_non_https_or_malformed_is_rejected(url: str):
    with pytest.raises(BlockedUrlError):
        await assert_fetchable(url, PUBLIC)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",        # loopback
        "10.0.0.5",         # private
        "172.16.3.9",       # private
        "192.168.1.10",     # private
        "169.254.169.254",  # cloud metadata — the one that matters
        "::1",              # IPv6 loopback
        "fd00::1",          # IPv6 unique-local
        "fe80::1",          # IPv6 link-local
        "0.0.0.0",
    ],
)
async def test_hostname_resolving_to_a_private_ip_is_rejected(ip: str):
    """DNS rebinding: a public-looking hostname that resolves inside the network.

    This is the case the on-device guard structurally CANNOT catch.
    """
    with pytest.raises(BlockedUrlError) as exc:
        await assert_fetchable("https://evil.example.org/f.opds", resolver_returning(ip))
    assert exc.value.reason == "blocked_host"


@pytest.mark.asyncio
async def test_rejects_when_ANY_resolved_address_is_private():
    """A host resolving to both a public and a private address is still blocked."""
    mixed = resolver_returning("93.184.216.34", "127.0.0.1")
    with pytest.raises(BlockedUrlError):
        await assert_fetchable("https://evil.example.org/f.opds", mixed)


@pytest.mark.asyncio
async def test_literal_private_ip_host_is_rejected_without_dns():
    async def _explode(host: str) -> list[str]:
        raise AssertionError("must not resolve a literal IP")

    with pytest.raises(BlockedUrlError):
        await assert_fetchable("https://127.0.0.1/f.opds", _explode)


@pytest.mark.asyncio
async def test_unresolvable_host_is_rejected():
    async def _fail(host: str) -> list[str]:
        raise OSError("NXDOMAIN")

    with pytest.raises(BlockedUrlError):
        await assert_fetchable("https://nope.invalid/f.opds", _fail)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible && pytest backend/tests/test_shelves_url_guard.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.src.shelves.url_guard`.

- [ ] **Step 3: Write the implementation**

```python
# backend/src/shelves/url_guard.py
"""SSRF guard for the anonymous OPDS feed-fetch endpoint (ADR-028 web escape hatch).

The device-side guard (mobile/src/openshelves/fetchFeed.ts) can only reject literal
private-IP hosts: browser `fetch` never exposes the resolved address, so a public
hostname that resolves to 127.0.0.1 slips past it. Server-side we CAN resolve first,
and we must — an SSRF here reaches our internal network and the cloud metadata
endpoint (169.254.169.254), not just one user's LAN.

Residual, accepted: a TOCTOU window remains between our resolve and httpx's own
resolve at connect time. Closing it fully means pinning the connection to the
checked IP (custom transport + SNI juggling). The redirect re-check (feed_fetch.py)
and this pre-check block every practical bypass we know of; revisit if this endpoint
is ever exposed to untrusted volume.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

Resolver = Callable[[str], Awaitable[list[str]]]


class BlockedUrlError(ValueError):
    """The server refuses to fetch this URL."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


def _is_blocked_ip(raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return True  # un-parseable address: refuse rather than guess
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local  # includes 169.254.169.254
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


async def default_resolver(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    return [info[4][0] for info in infos]


async def assert_fetchable(url: str, resolve: Resolver) -> str:
    """Return `url` if the server may fetch it; else raise BlockedUrlError."""
    parts = urlsplit((url or "").strip())
    if parts.scheme != "https":
        raise BlockedUrlError("Feed URLs must use https.", "not_https")

    host = parts.hostname
    if not host:
        raise BlockedUrlError("That doesn't look like a valid URL.", "invalid_url")

    # A literal IP host needs no DNS — check it directly.
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if _is_blocked_ip(host):
            raise BlockedUrlError("That host isn't allowed.", "blocked_host")
        return url

    try:
        addresses = await resolve(host)
    except Exception as exc:  # NXDOMAIN, timeout, …
        raise BlockedUrlError("Could not reach that host.", "blocked_host") from exc

    if not addresses:
        raise BlockedUrlError("Could not reach that host.", "blocked_host")
    # ANY private address blocks the host — a split-horizon record must not slip through.
    if any(_is_blocked_ip(a) for a in addresses):
        raise BlockedUrlError("That host isn't allowed.", "blocked_host")
    return url
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_shelves_url_guard.py -q`
Expected: PASS — 16 passed (5 non-https/malformed + 9 private IPs + the rest).

- [ ] **Step 5: Commit**

```bash
git add backend/src/shelves/__init__.py backend/src/shelves/url_guard.py backend/tests/test_shelves_url_guard.py
git commit -m "feat(shelves): SSRF guard for the web feed-fetch seam (resolve-then-check)"
```

---

### Task 2: The feed fetcher — caps, manual redirects, content-type allowlist

**Files:**
- Create: `backend/src/shelves/feed_fetch.py`
- Test: `backend/tests/test_shelves_feed_fetch.py`

**Interfaces:**
- Consumes: `assert_fetchable`, `BlockedUrlError`, `Resolver`, `default_resolver` from `.url_guard` (Task 1).
- Produces:
  - `MAX_FEED_BYTES: int = 8 * 1024 * 1024`, `TIMEOUT_S: float = 10.0`, `MAX_REDIRECTS: int = 3`
  - `ALLOWED_CONTENT_TYPES: frozenset[str]` = `{"application/atom+xml", "application/xml", "text/xml"}`
  - `class FeedFetchError(Exception)` with `.reason: str` — one of `"auth_required" | "upstream_error" | "too_large" | "not_a_feed"` — and `.status: int | None` (the upstream HTTP status, when there was one).
  - `@dataclass(frozen=True) class FetchedFeed: body: bytes; content_type: str`
  - `async def fetch_feed(url: str, client: httpx.AsyncClient, resolve: Resolver = default_resolver) -> FetchedFeed`

**Notes for the implementer:** `client` is injected so tests use `httpx.MockTransport` — never a live network. Redirects are followed **manually** (`follow_redirects=False` on every request) and every hop is re-validated through `assert_fetchable`; auto-following is the classic SSRF bypass (`https://public/x` → `302` → `http://127.0.0.1:6379/`). Send **no** auth headers. Stream the body and abort the moment the cap is crossed — a body with no `content-length` must not be able to exhaust memory.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_shelves_feed_fetch.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_shelves_feed_fetch.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.src.shelves.feed_fetch`.

- [ ] **Step 3: Write the implementation**

```python
# backend/src/shelves/feed_fetch.py
"""Fetch an OPDS feed document on a web client's behalf (ADR-028 web escape hatch).

A dumb, capped pipe: fetch bytes, enforce https/size/timeout/content-type, hand the
body back UNCHANGED. It parses nothing (the hardened client parser stays the single
hostile-XML boundary) and stores nothing (no cache — a cache would park third-party
bytes on our infra, which ADR-028 D2 forbids).

Metadata only. This module must never fetch a book file.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from backend.src.core.log_redaction import get_logger
from backend.src.shelves.url_guard import Resolver, assert_fetchable, default_resolver

log = get_logger("shelves.feed_fetch")

MAX_FEED_BYTES = 8 * 1024 * 1024  # keep in step with mobile MAX_FEED_BYTES
TIMEOUT_S = 10.0
MAX_REDIRECTS = 3
ALLOWED_CONTENT_TYPES = frozenset(
    {"application/atom+xml", "application/xml", "text/xml"}
)


class FeedFetchError(Exception):
    def __init__(self, message: str, reason: str, status: int | None = None) -> None:
        super().__init__(message)
        self.reason = reason
        self.status = status


@dataclass(frozen=True)
class FetchedFeed:
    body: bytes
    content_type: str


def _base_type(content_type: str) -> str:
    return content_type.split(";", 1)[0].strip().lower()


async def _read_capped(response: httpx.Response) -> bytes:
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_FEED_BYTES:
        raise FeedFetchError("That feed is too large to add.", "too_large")

    chunks: list[bytes] = []
    total = 0
    stream: AsyncIterator[bytes] = response.aiter_bytes()
    async for chunk in stream:
        total += len(chunk)
        if total > MAX_FEED_BYTES:
            await response.aclose()
            raise FeedFetchError("That feed is too large to add.", "too_large")
        chunks.append(chunk)
    return b"".join(chunks)


async def fetch_feed(
    url: str,
    client: httpx.AsyncClient,
    resolve: Resolver = default_resolver,
) -> FetchedFeed:
    """Fetch `url` and return its bytes. Raises BlockedUrlError / FeedFetchError."""
    current = await assert_fetchable(url, resolve)

    for _ in range(MAX_REDIRECTS + 1):
        request = client.build_request(
            "GET",
            current,
            timeout=TIMEOUT_S,
            # No auth of any kind reaches a third-party host (ADR-028 no-auth guardrail).
            headers={"accept": "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8"},
        )
        response = await client.send(request, stream=True, follow_redirects=False)

        if response.is_redirect:
            location = response.headers.get("location", "")
            await response.aclose()
            if not location:
                raise FeedFetchError("The feed responded with an error.", "upstream_error")
            # Re-validate EVERY hop: auto-following is how public -> 127.0.0.1 gets in.
            current = await assert_fetchable(str(httpx.URL(current).join(location)), resolve)
            continue

        try:
            if response.status_code in (401, 403):
                raise FeedFetchError(
                    "Authenticated repos aren't supported yet.",
                    "auth_required",
                    response.status_code,
                )
            if response.status_code >= 400:
                raise FeedFetchError(
                    f"The feed responded with an error (HTTP {response.status_code}).",
                    "upstream_error",
                    response.status_code,
                )

            content_type = response.headers.get("content-type", "")
            if _base_type(content_type) not in ALLOWED_CONTENT_TYPES:
                # An HTML error page must never reach the parser.
                raise FeedFetchError(
                    "That URL doesn't look like an OPDS catalog.", "not_a_feed"
                )

            body = await _read_capped(response)
        finally:
            await response.aclose()

        return FetchedFeed(body=body, content_type=content_type)

    raise FeedFetchError("The feed redirected too many times.", "upstream_error")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_shelves_feed_fetch.py -q`
Expected: PASS — 11 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shelves/feed_fetch.py backend/tests/test_shelves_feed_fetch.py
git commit -m "feat(shelves): capped feed fetcher (manual redirect re-validation, content-type allowlist)"
```

---

### Task 3: Fail-closed rate limiter for the anonymous endpoint

**Files:**
- Modify: `backend/src/core/rate_limit.py` (append a second dependency; do **not** change `enforce_rate_limit`)
- Modify: `backend/config.py` (two new settings, next to `rate_limit_per_minute`)
- Test: `backend/tests/test_shelves_rate_limit.py`

**Interfaces:**
- Produces: `async def enforce_feed_rate_limit(request: Request, r: redis.Redis = Depends(get_redis)) -> None` — a FastAPI dependency. Per-IP fixed window. **Fail-CLOSED**: a Redis error raises `503`, it does not allow the request.
- Config: `feed_fetch_per_minute: int = Field(default=20, ge=0)`, `feed_fetch_per_day: int = Field(default=300, ge=0)`.

**Why a separate dependency:** the existing `enforce_rate_limit` is deliberately **fail-open** — a limiter outage must not take down `/generate`, which needs Redis anyway and would fail regardless. That reasoning inverts here. This endpoint is **anonymous** and fetches **arbitrary URLs**, so the rate limit *is* the abuse control; failing open would turn a Redis outage into an unlimited open fetcher. Refusing service beats becoming an abuse relay. Keyed on IP only — there is no principal to key on.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_shelves_rate_limit.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_shelves_rate_limit.py -q`
Expected: FAIL — `ImportError: cannot import name 'enforce_feed_rate_limit'`.

- [ ] **Step 3: Write the implementation**

Add to `backend/config.py`, immediately after `rate_limit_per_day`:

```python
    # Open Shelves web feed-fetch limiter (ADR-028 escape hatch). This endpoint is
    # ANONYMOUS and fetches arbitrary third-party URLs, so its limiter is the abuse
    # control — and unlike the /generate limiter it fails CLOSED (see rate_limit.py).
    feed_fetch_per_minute: int = Field(default=20, ge=0)
    feed_fetch_per_day: int = Field(default=300, ge=0)
```

Append to `backend/src/core/rate_limit.py` (leave `enforce_rate_limit` exactly as it is):

```python
async def enforce_feed_rate_limit(
    request: Request,
    r: redis.Redis = Depends(get_redis),
) -> None:
    """Per-IP limiter for the anonymous Open Shelves feed fetch — FAIL-CLOSED.

    `enforce_rate_limit` above fails OPEN on purpose: a limiter outage must not take
    down /generate, which needs Redis anyway. That logic inverts here. This endpoint
    takes no auth and fetches arbitrary URLs, so the limiter IS the abuse control —
    failing open would turn a Redis outage into an unlimited open fetcher. We would
    rather refuse service than become an abuse relay.
    """
    if not settings.rate_limit_enabled:
        return

    host = request.client.host if request.client else "unknown"
    identity = f"feed:{host}"
    now = int(time.time())

    try:
        allowed, retry = await _window_hit(
            r,
            f"rl:feed:min:{identity}:{now // _MINUTE}",
            settings.feed_fetch_per_minute,
            _MINUTE,
        )
        if allowed:
            allowed, retry = await _window_hit(
                r,
                f"rl:feed:day:{identity}:{now // _DAY}",
                settings.feed_fetch_per_day,
                _DAY,
            )
    except Exception:
        log.warning("feed_rate_limit_backend_error")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="feed fetching is temporarily unavailable",
        ) from None

    if not allowed:
        log.info("feed_rate_limited", identity=identity, retry_after=retry)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many feed requests. Try again in a minute.",
            headers={"Retry-After": str(retry)},
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_shelves_rate_limit.py -q`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/rate_limit.py backend/config.py backend/tests/test_shelves_rate_limit.py
git commit -m "feat(shelves): fail-closed per-IP limiter for the anonymous feed fetch"
```

---

### Task 4: The route — `GET /api/v1/shelves/feed`

**Files:**
- Create: `backend/src/shelves/router.py`
- Modify: `backend/main.py` (import + `include_router`, alongside the existing routers around line 102-109)
- Test: `backend/tests/test_shelves_api.py`

**Interfaces:**
- Consumes: `fetch_feed`, `FeedFetchError`, `FetchedFeed` (Task 2); `BlockedUrlError` (Task 1); `enforce_feed_rate_limit` (Task 3).
- Produces: `router = APIRouter(prefix="/api/v1/shelves", tags=["shelves"])` with `GET /feed?url=<encoded>`.
  - Success → `200`, body = the upstream bytes verbatim, `content-type` = the upstream content-type.
  - Failure → JSON `{"detail": {"code": <reason>, "message": <copy>}}` with status:

| reason | status |
|---|---|
| `invalid_url`, `not_https`, `blocked_host`, `not_a_feed` | `400` |
| `auth_required` | `502` |
| `upstream_error` | `502` |
| `too_large` | `413` |
| rate limited (Task 3) | `429` |
| Redis down (Task 3) | `503` |

**Notes for the implementer:** **No auth dependency** — this endpoint is anonymous by design (spec W2). The `url` query param is required. The response must be `Response(content=..., media_type=...)`, NOT a JSON wrapper: the client parses the raw XML itself.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_shelves_api.py
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
    async def _noop(*args, **kwargs):
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_shelves_api.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.src.shelves.router`.

- [ ] **Step 3: Write the implementation**

```python
# backend/src/shelves/router.py
"""Open Shelves feed-metadata fetch (ADR-028 web escape hatch).

Browsers cannot fetch OPDS feeds directly: the feeds send no CORS headers, so the
device->source model ADR-028 assumes is blocked in a browser (it works fine on the
APK, which is why this endpoint is web-only in practice).

This returns feed METADATA only. It must never fetch, host, mirror, cache, or relay
a book file — those still go source->device (on web, the browser's own download).
Anonymous by design: Open Shelves needs no account, so the abuse control is the
fail-closed per-IP limiter plus the SSRF guard, not an auth wall.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_feed_rate_limit
from backend.src.shelves.feed_fetch import TIMEOUT_S, FeedFetchError, fetch_feed
from backend.src.shelves.url_guard import BlockedUrlError

log = get_logger("shelves.router")

router = APIRouter(prefix="/api/v1/shelves", tags=["shelves"])

_STATUS_FOR = {
    "invalid_url": status.HTTP_400_BAD_REQUEST,
    "not_https": status.HTTP_400_BAD_REQUEST,
    "blocked_host": status.HTTP_400_BAD_REQUEST,
    "not_a_feed": status.HTTP_400_BAD_REQUEST,
    "too_large": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    "auth_required": status.HTTP_502_BAD_GATEWAY,
    "upstream_error": status.HTTP_502_BAD_GATEWAY,
}


def _fail(reason: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=_STATUS_FOR.get(reason, status.HTTP_502_BAD_GATEWAY),
        detail={"code": reason, "message": message},
    )


@router.get("/feed", dependencies=[Depends(enforce_feed_rate_limit)])
async def get_feed(url: str = Query(..., description="The OPDS feed URL")) -> Response:
    """Fetch an OPDS feed and return its bytes UNCHANGED (we are a pipe, not a parser)."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            feed = await fetch_feed(url, client)
    except BlockedUrlError as err:
        log.info("feed_fetch_blocked", reason=err.reason)
        raise _fail(err.reason, str(err)) from None
    except FeedFetchError as err:
        log.info("feed_fetch_failed", reason=err.reason, upstream_status=err.status)
        raise _fail(err.reason, str(err)) from None
    except httpx.HTTPError as err:
        log.info("feed_fetch_transport_error", error_type=type(err).__name__)
        raise _fail("upstream_error", "Could not reach the feed.") from None

    return Response(content=feed.body, media_type=feed.content_type)
```

Register it in `backend/main.py` — add the import beside the other router imports, and the `include_router` call after `app.include_router(sharing_router.router)`:

```python
from backend.src.shelves import router as shelves_router
...
app.include_router(shelves_router.router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_shelves_api.py backend/tests/test_shelves_feed_fetch.py backend/tests/test_shelves_url_guard.py backend/tests/test_shelves_rate_limit.py -q`
Expected: PASS — 6 + 11 + 16 + 4 passed.

Then confirm nothing else broke: `pytest backend/tests -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shelves/router.py backend/main.py backend/tests/test_shelves_api.py
git commit -m "feat(shelves): GET /api/v1/shelves/feed — anonymous metadata-only feed fetch"
```

---

### Task 5: Mobile — the `feedTransport` seam

**Files:**
- Create: `mobile/src/openshelves/feedTransport.ts`
- Modify: `mobile/src/openshelves/fetchFeed.ts` (route the request URL through the seam; map proxied errors)
- Test: `mobile/src/openshelves/__tests__/feedTransport.test.ts`, extend `mobile/src/openshelves/__tests__/fetchFeed.test.ts`

**Interfaces:**
- Consumes: `resolveBaseUrl` from `@/api/client`; `FeedSourceError`, `FeedParseError` from `./errors`.
- Produces:
  - `export const usesFeedProxy: boolean` — `Platform.OS === "web"`.
  - `export function feedRequestUrl(feedUrl: string): string` — native → `feedUrl`; web → `${resolveBaseUrl()}/api/v1/shelves/feed?url=${encodeURIComponent(feedUrl)}`.
  - `export async function proxyErrorFor(resp: Response): Promise<Error>` — reads the backend's `{"detail":{"code","message"}}` body and returns the matching `FeedSourceError` / `FeedParseError` (`auth_required` → `FeedSourceError` with `authRequired: true`; `too_large` → `FeedParseError`).

**Notes for the implementer:** `validateFeedUrl` still runs client-side, unchanged — it is a UX affordance (fail fast, same copy on both platforms), **not** a security control; the server re-validates everything. `fetchFeed` keeps ONE body: only the request URL and the error mapping differ.

- [ ] **Step 1: Write the failing tests**

```typescript
// mobile/src/openshelves/__tests__/feedTransport.test.ts
import { Platform } from "react-native";
import { feedRequestUrl, proxyErrorFor, usesFeedProxy } from "../feedTransport";
import { FeedParseError, FeedSourceError } from "../errors";

jest.mock("@/api/client", () => ({ resolveBaseUrl: () => "https://api.test" }));

const FEED = "https://m.gutenberg.org/ebooks/2701.opds";

test("native fetches the feed directly (ADR-028: device -> source)", () => {
  expect(Platform.OS).not.toBe("web"); // jest-expo runs the native preset
  expect(usesFeedProxy).toBe(false);
  expect(feedRequestUrl(FEED)).toBe(FEED);
});

test("proxy URL encodes the feed URL as a query param", () => {
  // Exercised directly: the web branch is unreachable under the native jest preset.
  const url = `https://api.test/api/v1/shelves/feed?url=${encodeURIComponent(FEED)}`;
  expect(url).toContain("url=https%3A%2F%2Fm.gutenberg.org%2Febooks%2F2701.opds");
});

test("auth_required maps to FeedSourceError{authRequired}", async () => {
  const resp = {
    json: async () => ({ detail: { code: "auth_required", message: "Authenticated repos aren't supported yet." } }),
    status: 502,
  } as Response;
  const err = await proxyErrorFor(resp);
  expect(err).toBeInstanceOf(FeedSourceError);
  expect((err as FeedSourceError).authRequired).toBe(true);
});

test("too_large maps to FeedParseError", async () => {
  const resp = {
    json: async () => ({ detail: { code: "too_large", message: "That feed is too large to add." } }),
    status: 413,
  } as Response;
  expect(await proxyErrorFor(resp)).toBeInstanceOf(FeedParseError);
});

test("an unparseable error body still yields a usable message", async () => {
  const resp = {
    json: async () => { throw new Error("not json"); },
    status: 500,
  } as Response;
  const err = await proxyErrorFor(resp);
  expect(err).toBeInstanceOf(FeedSourceError);
  expect(err.message).toMatch(/could not reach the feed/i);
});
```

Add to `mobile/src/openshelves/__tests__/fetchFeed.test.ts`:

```typescript
test("fetchFeed requests the feed URL itself on native", async () => {
  const seen: string[] = [];
  const fake = (async (u: string) => {
    seen.push(u);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => "<feed/>" } as any;
  }) as unknown as typeof fetch;

  await fetchFeed("https://ex.org/f.opds", fake);
  expect(seen[0]).toBe("https://ex.org/f.opds"); // no proxy on native
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedTransport.test.ts`
Expected: FAIL — cannot find module `../feedTransport`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/feedTransport.ts
// Where a feed request goes. Native fetches the feed directly (ADR-028: device ->
// source). The browser CANNOT: OPDS feeds send no Access-Control-Allow-Origin, so a
// direct cross-origin fetch is blocked by CORS. On web we ask our backend to fetch
// the feed DOCUMENT for us (metadata only — book files still download source ->
// device, via the browser's own download).
//
// This seam swaps only the request URL. fetchFeed keeps one body.
import { Platform } from "react-native";
import { resolveBaseUrl } from "@/api/client";
import { FeedParseError, FeedSourceError } from "./errors";

export const usesFeedProxy = Platform.OS === "web";

export function feedRequestUrl(feedUrl: string): string {
  if (!usesFeedProxy) return feedUrl;
  return `${resolveBaseUrl()}/api/v1/shelves/feed?url=${encodeURIComponent(feedUrl)}`;
}

// The backend answers failures as {"detail": {"code", "message"}} — map each code
// back onto the same error vocabulary the direct path produces, so the UI copy is
// identical on web and native.
export async function proxyErrorFor(resp: Response): Promise<Error> {
  let code = "";
  let message = "";
  try {
    const body = await resp.json();
    code = body?.detail?.code ?? "";
    message = body?.detail?.message ?? "";
  } catch {
    // A non-JSON error body (a gateway's own 502 page, say) — fall through.
  }
  if (!message) message = `Could not reach the feed (HTTP ${resp.status}).`;

  if (code === "auth_required") return new FeedSourceError(message, { authRequired: true });
  if (code === "too_large") return new FeedParseError(message);
  return new FeedSourceError(message);
}
```

Modify `mobile/src/openshelves/fetchFeed.ts` — in `fetchFeed`, request through the seam and map proxied errors. Replace the request + status-handling block:

```typescript
export async function fetchFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clean = validateFeedUrl(url);   // still fail-fast UX; the server re-validates
  let resp: Response;
  try {
    resp = await fetchImpl(feedRequestUrl(clean), { method: "GET" });
  } catch (err) {
    throw new FeedSourceError(`Could not reach the feed: ${(err as Error).message}`);
  }
  if (usesFeedProxy && !resp.ok) {
    throw await proxyErrorFor(resp);    // the backend already classified it
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new FeedSourceError("Authenticated repos aren't supported yet.", { authRequired: true });
  }
  if (!resp.ok) {
    throw new FeedSourceError(`The feed responded with an error (HTTP ${resp.status}).`);
  }
  // ... the existing content-length / streamed cap / text() logic is UNCHANGED ...
```

and add the import at the top:

```typescript
import { feedRequestUrl, proxyErrorFor, usesFeedProxy } from "./feedTransport";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest src/openshelves && npx tsc --noEmit -p tsconfig.json`
Expected: PASS — all Open Shelves suites green, no new tsc errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/feedTransport.ts mobile/src/openshelves/fetchFeed.ts mobile/src/openshelves/__tests__/feedTransport.test.ts mobile/src/openshelves/__tests__/fetchFeed.test.ts
git commit -m "feat(open-shelves): route web feed fetches through the backend (CORS)"
```

---

### Task 6: ADR-028 amendment + Help copy

**Files:**
- Modify: `docs/adr/ADR-028-open-shelves-free-book-repo-feeds.md` (amend D2; resolve Open Question 3 / Risk 3)
- Modify: `mobile/src/help-content/topics.ts` (the `open-shelves` topic — add a web caveat def)
- Test: `cd mobile && npx jest __tests__/help` (the coverage gate must stay green)

**Interfaces:** none (docs + content only).

- [ ] **Step 1: Amend ADR-028**

In **D2**, append this clause:

```markdown
> **Amended 2026-07-13 (web CORS escape hatch).** The server may **fetch feed
> metadata** on behalf of a client that cannot: a browser is blocked by CORS from
> fetching an OPDS feed directly (feeds send no `Access-Control-Allow-Origin`;
> Project Gutenberg does not, and verification on 2026-07-13 showed Open Shelves is
> unusable on web without this). `GET /api/v1/shelves/feed` fetches the feed
> **document** and returns its bytes unparsed and uncached.
>
> **Metadata-fetch ≠ content-proxy.** The server still never fetches, hosts, mirrors,
> caches, or relays a **book file** — book bytes go source → device on every platform
> (on web, via the browser's own download). D2's substance is unchanged; this names
> the one document the server is permitted to fetch.
>
> Scope: **web only** (native still fetches feeds direct). **Anonymous** (Open Shelves
> needs no account), so the abuse controls are a resolve-then-check SSRF guard and a
> **fail-closed** per-IP rate limiter — not an auth wall. **No caching**, which is what
> keeps this inside D2 rather than a reversal of it.
```

Under **Open questions**, mark question 3 resolved:

```markdown
3. ~~**Web CORS asymmetry** — metadata-only proxy is the escape hatch if the asymmetry
   proves unacceptable.~~ **RESOLVED 2026-07-13:** it proved unacceptable (Gutenberg
   sends no CORS headers; Open Shelves was entirely unusable on web). The metadata-only
   fetch endpoint is built — see the D2 amendment above.
```

- [ ] **Step 2: Add the Help caveat**

In `mobile/src/help-content/topics.ts`, inside the `open-shelves` topic's `defs` array, append:

```typescript
          {
            term: "Catalogs on the web app",
            def: "In a browser, Mentible asks its own server to fetch the catalog listing, because browsers block sites from reading most catalogs directly. Only the listing goes through us — the book itself always downloads straight from the library to you.",
          },
```

- [ ] **Step 3: Verify the docs + gate**

Run: `cd mobile && npx jest __tests__/help`
Expected: PASS — the Help coverage gate stays green (`open-shelves` already has its feature key + topic).

- [ ] **Step 4: Commit**

```bash
git add docs/adr/ADR-028-open-shelves-free-book-repo-feeds.md mobile/src/help-content/topics.ts
git commit -m "docs(adr-028): amend D2 — metadata-fetch is not a content-proxy (resolves OQ3)"
```

---

### Task 7: End-to-end verification on the real web app

> The unit tests mock the network on both sides. This task proves the actual thing works in a real browser against the real backend — the bug that started this whole plan was invisible to unit tests.

- [ ] Start the backend: `cd backend && uvicorn main:app --reload` (localhost:8000).
- [ ] Point `mobile/.env.local`'s `EXPO_PUBLIC_API_BASE_URL` at that backend, then `cd mobile && npx expo start --web`.
- [ ] In the browser: Shelves → add `https://m.gutenberg.org/ebooks/2701.opds` → **the source is added and its entries appear** (this is the exact flow that failed with "Could not reach the feed: Failed to fetch").
- [ ] Confirm the browser console has **no CORS error** for the feed request, and that the feed request goes to `localhost:8000/api/v1/shelves/feed`, not to gutenberg.org.
- [ ] Open the entry → click **Download** → the browser downloads the EPUB, and the network panel shows it coming **from gutenberg.org, NOT from our backend** (the line: the server fetches metadata, never content).
- [ ] Try a blocked URL — `https://localhost/f.opds` and a host that resolves to a private IP — and confirm a clean "That host isn't allowed." rather than a stack trace or a hang.
- [ ] Confirm Android is unaffected: the APK still fetches feeds directly (no backend needed).

---

## What this plan leaves to later plans

- **Starter list (P0-5)** — and its feed survey must now assume "no CORS" is the norm, and re-verify liveness: **Standard Ebooks' OPDS is 401** (auth-gated) and **Feedbooks' public-domain URL is 404** as of 2026-07-13.
- **Language filter (F-1)**, auto-refresh, QR/deep-link.
- **Conditional GET / caching** — deliberately excluded (spec W4); it would mean storing third-party bytes and needs its own ADR-028 amendment.
- **Pinning the connection to the checked IP** — closes the residual TOCTOU window in the SSRF guard. The pre-check plus per-hop redirect re-validation block every practical bypass we know of; revisit if this endpoint ever sees untrusted volume.

## Self-Review

**Spec coverage:** W1 web-only → Task 5 (`usesFeedProxy`) + Task 7 (Android unaffected). W2 anonymous + rate-limited → Task 3 (limiter) + Task 4 (no auth dependency, asserted in `test_happy_path_returns_raw_xml_and_requires_no_auth`). W3 raw XML → Task 2 (`FetchedFeed.body` byte-for-byte) + Task 4 (`Response`, not JSON). W4 no caching → Global Constraints + Task 6 (ADR clause); no task adds a cache. W5 fail-closed → Task 3 (`test_redis_down_FAILS_CLOSED_with_503`). Guards 1-7 → Tasks 1-3. Error vocabulary → Task 2 reasons, Task 4 status map, Task 5 `proxyErrorFor`. ADR amendment → Task 6. Real-browser proof → Task 7.

**Placeholder scan:** none — every code step carries complete code; Task 6 carries the exact prose; Task 7 is a manual checklist by design (a real browser + a real backend cannot be unit-tested).

**Type consistency:** `BlockedUrlError.reason` (Task 1) feeds `_STATUS_FOR` (Task 4). `FeedFetchError.reason` values `auth_required | upstream_error | too_large | not_a_feed` (Task 2) are exactly the keys in `_STATUS_FOR` (Task 4) and the codes `proxyErrorFor` branches on (Task 5). `FetchedFeed{body, content_type}` (Task 2) is what the router returns (Task 4). `Resolver` (Task 1) is the injected type in `fetch_feed` (Task 2). `MAX_FEED_BYTES = 8 MiB` matches the mobile constant.
