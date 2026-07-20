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
    "too_large": status.HTTP_413_CONTENT_TOO_LARGE,
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
