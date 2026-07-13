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

from backend.src.shelves.url_guard import Resolver, assert_fetchable, default_resolver

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
        # Strip any credential the injected client carries by default (e.g. an
        # Authorization/Cookie set on the client itself). build_request() merges
        # client.headers into the request, so this must happen AFTER build_request,
        # on every hop -- the guarantee must not depend on the caller's client being
        # credential-free (ADR-028 no-auth guardrail).
        request.headers.pop("authorization", None)
        request.headers.pop("cookie", None)
        response = await client.send(
            request, stream=True, follow_redirects=False, auth=None
        )

        if response.is_redirect:
            location = response.headers.get("location", "")
            await response.aclose()
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
