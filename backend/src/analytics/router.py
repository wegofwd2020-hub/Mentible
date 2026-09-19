"""Analytics ingestion endpoint — POST /api/v1/analytics/events."""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.analytics.intervention import InterventionService
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.repo import (
    get_events_for_user,
    get_journey_state,
    record_event,
    upsert_journey_state,
)
from backend.src.analytics.schemas import EventIn
from backend.src.auth.deps import require_super_admin
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


class SendInterventionsRequest(BaseModel):
    """Send interventions to stalled users (manual super-admin trigger)."""
    user_id: UUID | None = None
    dry_run: bool = False


class SendInterventionsResponse(BaseModel):
    """Response: how many interventions were sent."""
    sent_count: int
    dry_run: bool = False
    user_id: UUID | None = None


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


@router.post("/interventions/send-stalled", status_code=status.HTTP_200_OK)
async def send_interventions(
    body: SendInterventionsRequest,
    principal: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> SendInterventionsResponse:
    """Send intervention emails to stalled users (super-admin only, MVP manual trigger).

    Args:
        user_id: Optional. Send to one user only. If omitted, send to all with intervention_status=not_started
        dry_run: If true, don't actually send; just return count

    Returns:
        Count of emails sent (or would-be sent if dry_run=true)

    This is the manual trigger for MVP. Scheduler job (deferred to 3B) will enable automatic daily sends.
    """
    service = InterventionService()
    sent_count = 0

    if body.user_id:
        # Send to one user
        journey = await get_journey_state(conn, body.user_id)
        account = await accounts_repo.get_account(conn, body.user_id)

        if not journey or not account or journey["intervention_status"] != "not_started":
            raise HTTPException(
                400,
                "User not found, not stalled, or already has intervention pending",
            )

        if not body.dry_run:
            sent = await service.send_intervention_for_user(
                conn,
                body.user_id,
                account.email,
                journey["stall_reason"],
                journey,
            )
            sent_count = 1 if sent else 0

        return SendInterventionsResponse(
            sent_count=sent_count,
            dry_run=body.dry_run,
            user_id=body.user_id,
        )
    else:
        # Send to all intervention_status=not_started
        stalled_users = await conn.fetch(
            """SELECT id, email FROM account a
               JOIN journey_state j ON a.id = j.user_id
               WHERE j.intervention_status = 'not_started' AND j.stalled_at IS NOT NULL"""
        )

        for row in stalled_users:
            account_id = row["id"]
            email = row["email"]
            journey = await get_journey_state(conn, account_id)

            if journey and email:
                if not body.dry_run:
                    sent = await service.send_intervention_for_user(
                        conn,
                        account_id,
                        email,
                        journey["stall_reason"],
                        journey,
                    )
                    if sent:
                        sent_count += 1

        return SendInterventionsResponse(
            sent_count=sent_count,
            dry_run=body.dry_run,
        )
