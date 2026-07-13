"""Per-identity request rate limiting for the expensive endpoints.

A fixed-window Redis counter, applied as a FastAPI dependency to /generate,
/structure, and /export. Two windows: a per-minute burst guard and a per-day
cap (cost-control for managed token spend, ADR-005). Keyed on the verified IdP
principal (`sub`) when present, else the client IP.

Design choices:
- **Fixed window, not sliding.** INCR + EXPIRE is one round-trip per window and
  needs no Lua; the small boundary burst is acceptable for an abuse/cost guard.
- **Fail-open.** If Redis is unreachable the request is allowed (with a warning):
  a limiter outage must not take down the API. Generation already depends on
  Redis (the BYOK envelope), so a Redis outage fails generation anyway.
- **No key, no PII beyond the identity.** The `sub` is an opaque IdP id and the
  IP is request metadata; neither is a secret. Counters carry no content.

Disabled when `rate_limit_enabled` is False or a limit is <= 0.
"""

from __future__ import annotations

import time

import redis.asyncio as redis
from fastapi import Depends, HTTPException, Request, status

from backend.config import settings
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.core.log_redaction import get_logger
from backend.src.core.redis_dep import get_redis

log = get_logger("rate_limit")

_MINUTE = 60
_DAY = 86_400


def _identity(request: Request, principal: Principal | None) -> str:
    """Stable limiter identity: the authed principal, else the client IP.

    Prefixed so an IP can never collide with a `sub`. Anonymous callers with no
    resolvable client fall back to a shared bucket (still bounds total load).
    """
    if principal is not None:
        return f"sub:{principal.sub}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


async def _window_hit(r: redis.Redis, key: str, limit: int, ttl: int) -> tuple[bool, int]:
    """INCR one fixed-window counter. Returns (allowed, retry_after_seconds).

    A limit of 0 disables this window (always allowed).
    """
    if limit <= 0:
        return True, 0
    count = await r.incr(key)
    if count == 1:
        # First hit in this window — set the expiry that defines the window.
        await r.expire(key, ttl)
    if count > limit:
        retry = await r.ttl(key)
        return False, max(int(retry), 1)
    return True, 0


async def enforce_rate_limit(
    request: Request,
    principal: Principal | None = Depends(optional_user),
    r: redis.Redis = Depends(get_redis),
) -> None:
    """FastAPI dependency — 429 when the caller exceeds the per-minute or per-day
    window. No-op when disabled. Fail-open on any Redis error."""
    if not settings.rate_limit_enabled:
        return

    identity = _identity(request, principal)
    now = int(time.time())

    try:
        minute_bucket = now // _MINUTE
        allowed, retry = await _window_hit(
            r,
            f"rl:min:{identity}:{minute_bucket}",
            settings.rate_limit_per_minute,
            _MINUTE,
        )
        if allowed:
            day_bucket = now // _DAY
            allowed, retry = await _window_hit(
                r,
                f"rl:day:{identity}:{day_bucket}",
                settings.rate_limit_per_day,
                _DAY,
            )
    except Exception:
        # Fail-open: a limiter backend outage must not break the API. Log the
        # event type only (no identity values that could be sensitive).
        log.warning("rate_limit_backend_error")
        return

    if not allowed:
        # Log the limit hit (identity is an opaque sub / IP — safe to record).
        log.info("rate_limited", identity=identity, retry_after=retry)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate limit exceeded; slow down",
            headers={"Retry-After": str(retry)},
        )


async def enforce_feed_rate_limit(
    request: Request,
    r: redis.Redis = Depends(get_redis),
) -> None:
    """Per-IP limiter for the anonymous Open Shelves feed fetch — FAIL-CLOSED.

    `enforce_rate_limit` above fails OPEN on purpose: a limiter outage must not
    take down /generate, which needs Redis anyway. That logic inverts here. This
    endpoint takes no auth and fetches arbitrary URLs, so the limiter IS the
    abuse control — failing open would turn a Redis outage into an unlimited
    open fetcher. We would rather refuse service than become an abuse relay.
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
