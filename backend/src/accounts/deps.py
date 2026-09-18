"""Account-aware auth dependency — `require_active_user` (ADR-020 D3.1 / O6).

The FastAPI-canonical split: `require_user` (in `auth/deps.py`) is the pure,
DB-free verify primitive — the portable seam that maps to the future
`wegofwd-identity` (ADR-020 D8). Suspension is *app state* (a DB flag), so the
check that rejects a suspended caller lives here, in the accounts layer, not in
the verify path.

`require_active_user` is the standard dependency for authenticated routes: it
verifies the token (via `require_user`) and then 403s if that account is
suspended. With no account store configured (anonymous demo), there is no
suspension state, so it is a pass-through.

O6 caveat: this blocks our authenticated routes only. Public BYOK generation
(`/generate`, key in the request body) is not gated by auth and is therefore not
stopped by a suspend; gating generation is a separate, still-open decision.
"""

from __future__ import annotations

import asyncpg
import structlog
from fastapi import Depends, HTTPException, Request, status
from uuid import uuid4

from backend.src.accounts import repo
from backend.src.analytics import repo as analytics_repo
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.models import DeviceClass, EventName
from backend.src.analytics.schemas import EventIn
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


async def require_active_user(
    request: Request, principal: Principal = Depends(require_user)
) -> Principal:
    """Verified caller who is not suspended; else 403. Pass-through when no DB.
    On first authenticated request (account not found), creates account and emits
    signup_completed event, then evaluates and persists journey state."""
    pool: asyncpg.Pool | None = getattr(request.app.state, "db", None)
    if pool is None:
        return principal  # no account store → no suspension state
    async with pool.acquire() as conn:
        account = await repo.get_account(conn, idp_sub=principal.sub)
        if account is None:
            # First login — create account and emit signup_completed.
            account = await repo.get_or_create_account(
                conn, idp_sub=principal.sub, email=principal.email
            )
            await _record_signup_completed(conn, user_id=account.id)
    if account is not None and account.suspended:
        # Body names no identity (key/identity discipline).
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account suspended")
    return principal


async def _record_signup_completed(conn: asyncpg.Connection, *, user_id) -> None:
    """Record signup_completed event and advance journey state on first login.
    Catches exceptions to avoid blocking auth on analytics failure."""
    try:
        # Create and record the signup_completed event.
        event = EventIn(
            event_name=EventName.SIGNUP_COMPLETED,
            session_id=str(uuid4()),
            device_class=DeviceClass.DESKTOP,
        )
        await analytics_repo.record_event(conn, event=event, user_id=user_id)

        # Retrieve full event history, evaluate journey state, and persist it.
        history = await analytics_repo.get_events_for_user(conn, user_id)
        result = evaluate_journey_state([dict(row) for row in history])

        await analytics_repo.upsert_journey_state(
            conn,
            user_id=user_id,
            current_journey_stage=result.current_journey_stage.value,
            stage_status=result.stage_status.value,
            last_meaningful_event=result.last_meaningful_event,
            last_meaningful_event_at=result.last_meaningful_event_at,
        )
    except Exception as e:
        # Log but do not raise — analytics failure must not block authentication.
        logger = structlog.get_logger(__name__)
        logger.warning(
            "analytics_signup_event_failed",
            user_id=str(user_id),
            error=str(e),
        )
