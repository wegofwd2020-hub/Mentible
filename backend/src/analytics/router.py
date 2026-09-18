"""Analytics ingestion endpoint — POST /api/v1/analytics/events."""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, status

from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.repo import (
    get_events_for_user,
    record_event,
    upsert_journey_state,
)
from backend.src.analytics.schemas import EventIn
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


@router.post("/events", status_code=status.HTTP_201_CREATED)
async def post_event(
    body: EventIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> dict[str, str]:
    """Ingest a single analytics event.

    Performs the full event → journey-state cycle:
    1. Gets/creates the account from the verified principal
    2. Records the event in analytics_event
    3. Fetches the user's full event history (oldest first)
    4. Evaluates journey state from that history (pure function, no DB)
    5. Upserts the computed journey_state

    Returns the event ID for idempotent client-side deduplication."""
    # Step 1: Get or create account
    account = await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )

    # Step 2: Record the event
    await record_event(conn, event=body, user_id=account.id)

    # Step 3: Fetch full event history
    events = await get_events_for_user(conn, account.id)
    # Convert asyncpg.Record rows to dicts for the pure evaluator
    event_dicts = [dict(e) for e in events]

    # Step 4: Evaluate journey state
    result = evaluate_journey_state(event_dicts)

    # Step 5: Upsert journey state
    await upsert_journey_state(
        conn,
        user_id=account.id,
        current_journey_stage=result.current_journey_stage.value,
        stage_status=result.stage_status.value,
        last_meaningful_event=result.last_meaningful_event,
        last_meaningful_event_at=result.last_meaningful_event_at,
    )

    return {"event_id": str(body.event_id)}
