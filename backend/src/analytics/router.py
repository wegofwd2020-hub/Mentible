"""Analytics ingestion endpoint — POST /api/v1/analytics/events."""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.analytics.dashboards import (
    get_completion_funnel,
    get_project_bottlenecks,
    get_re_engagement_by_reason,
    get_response_rate,
    get_retry_effectiveness,
    get_stall_by_stage,
    get_stalled_users,
    get_ttfr_distribution,
)
from backend.src.analytics.intervention import InterventionService
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.repo import (
    get_events_for_project,
    get_events_for_user,
    get_journey_state,
    record_event,
    upsert_journey_state,
    upsert_project_journey_state,
)
from backend.src.analytics.schemas import (
    DashboardResponseSchema,
    EventIn,
    FunnelRowSchema,
    ProjectBottleneckRowSchema,
    StalledUserRowSchema,
)
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

    # Step 5: Upsert journey state (global)
    await upsert_journey_state(
        conn,
        user_id=account.id,
        current_journey_stage=result.current_journey_stage.value,
        stage_status=result.stage_status.value,
        last_meaningful_event=result.last_meaningful_event,
        last_meaningful_event_at=result.last_meaningful_event_at,
    )

    # Step 6: If event has project_id, also upsert per-project journey state (UX analytics)
    if body.project_id:
        project_events = await get_events_for_project(conn, account.id, body.project_id)
        project_event_dicts = [dict(e) for e in project_events]
        project_result = evaluate_journey_state(project_event_dicts)

        await upsert_project_journey_state(
            conn,
            user_id=account.id,
            project_id=body.project_id,
            current_journey_stage=project_result.current_journey_stage.value,
            stage_status=project_result.stage_status.value,
            last_meaningful_event=project_result.last_meaningful_event,
            last_meaningful_event_at=project_result.last_meaningful_event_at,
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
        user_id: Optional. Send to one user only. If omitted, send to all due for intervention
        dry_run: If true, don't actually send; just return count
        force: If true, ignore retry interval and send anyway

    Returns:
        Count of emails sent (or would-be sent if dry_run=true)

    Sends to users with intervention_status=not_started, or to in_progress users if
    intervention_retry_interval_days has elapsed since last send.
    """
    from datetime import UTC, datetime

    from backend.src.admin.intervention_config import get_intervention_retry_interval_days

    service = InterventionService()
    sent_count = 0
    retry_interval = get_intervention_retry_interval_days()

    def _should_retry(journey: dict, force: bool = False) -> bool:
        """Check if user is due for retry intervention."""
        if force or journey["intervention_status"] == "not_started":
            return True
        if journey["intervention_status"] != "in_progress" or not journey.get(
            "intervention_sent_at"
        ):
            return False
        days_since_last = (datetime.now(UTC) - journey["intervention_sent_at"]).days
        return days_since_last >= retry_interval

    if body.user_id:
        # Send to one user
        journey = await get_journey_state(conn, body.user_id)
        account = await accounts_repo.get_account(conn, body.user_id)

        if not journey or not account:
            raise HTTPException(404, "User not found")
        if not journey.get("stalled_at"):
            raise HTTPException(400, "User not stalled")
        if not _should_retry(journey, body.force if hasattr(body, "force") else False):
            raise HTTPException(400, f"Not due for retry (interval: {retry_interval} days)")

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
        # Send to all users due for intervention
        stalled_users = await conn.fetch(
            """SELECT a.id, a.email FROM account a
               JOIN journey_state j ON a.id = j.user_id
               WHERE j.stalled_at IS NOT NULL
               AND (j.intervention_status = 'not_started'
                    OR (j.intervention_status = 'in_progress'
                        AND j.intervention_sent_at IS NOT NULL
                        AND (NOW() AT TIME ZONE 'UTC' - j.intervention_sent_at) >= INTERVAL '1 day' * %s))""",
            (retry_interval,),
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


@router.get("/dashboards/intervention-overview", status_code=status.HTTP_200_OK)
async def get_intervention_overview(
    principal: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> DashboardResponseSchema:
    """Get intervention dashboard metrics (super-admin only).

    Returns aggregated metrics for measuring intervention effectiveness:
    - Re-engagement rate by stall_reason
    - Time-to-first-response distribution (p50, p95)
    - Overall response rate (any response vs silent)
    - Retry effectiveness (success rate by attempt count)
    - Stall breakdown by journey stage (where users drop off)

    All metrics are computed from journey_state + analytics_event data.
    """
    # Query all 5 metrics in parallel
    re_engagement = await get_re_engagement_by_reason(conn)
    ttfr = await get_ttfr_distribution(conn)
    response_rate = await get_response_rate(conn)
    retry_effectiveness = await get_retry_effectiveness(conn)
    stall_by_stage = await get_stall_by_stage(conn)

    # Convert dataclass results to Pydantic schemas for response validation
    return DashboardResponseSchema(
        re_engagement=[
            {
                "stall_reason": row.stall_reason,
                "total_stalled": row.total_stalled,
                "resumed": row.resumed,
                "re_engagement_rate_pct": row.re_engagement_rate_pct,
            }
            for row in re_engagement
        ],
        ttfr=[
            {
                "stall_reason": row.stall_reason,
                "responded_count": row.responded_count,
                "p50_seconds": row.p50_seconds,
                "p95_seconds": row.p95_seconds,
            }
            for row in ttfr
        ],
        response_rate={
            "response_rate": response_rate.response_rate,
            "no_response_count": response_rate.no_response_count,
            "total_interventions": response_rate.total_interventions,
        },
        retry_effectiveness=[
            {
                "attempt_count": row.attempt_count,
                "attempts_made": row.attempts_made,
                "resumed": row.resumed,
                "success_rate_pct": row.success_rate_pct,
            }
            for row in retry_effectiveness
        ],
        stall_by_stage=[
            {
                "journey_stage": row.journey_stage,
                "total_stalled": row.total_stalled,
                "avg_time_in_stage_hours": row.avg_time_in_stage_hours,
                "stall_rate_pct": row.stall_rate_pct,
            }
            for row in stall_by_stage
        ],
    )


class ProjectUXAnalyticsResponse(BaseModel):
    """Per-project UX bottleneck analysis + funnel + stalled users list."""

    bottlenecks: list[ProjectBottleneckRowSchema] = []
    funnel: list[FunnelRowSchema] = []
    stalled_users: list[StalledUserRowSchema] = []


@router.get("/dashboards/project-ux/{project_id}", status_code=status.HTTP_200_OK)
async def get_project_ux_analytics(
    project_id: str,
    principal: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> ProjectUXAnalyticsResponse:
    """Get per-project UX bottleneck analysis (super-admin only).

    Shows where users get stuck in a specific project and intervention effectiveness.
    Useful for product teams to identify where UX needs improvement.

    Returns:
    - bottlenecks: stage-by-stage stall rates + intervention metrics
    - funnel: completion funnel (% advancing from stage N to N+1)
    - stalled_users: list of users currently stuck (for ops/support outreach)
    """
    bottlenecks = await get_project_bottlenecks(conn, project_id)
    funnel = await get_completion_funnel(conn, project_id)
    stalled_users = await get_stalled_users(conn, project_id)

    return ProjectUXAnalyticsResponse(
        bottlenecks=[
            {
                "project_id": row.project_id,
                "journey_stage": row.journey_stage,
                "total_users_at_stage": row.total_users_at_stage,
                "stalled_count": row.stalled_count,
                "stall_rate_pct": row.stall_rate_pct,
                "avg_hours_before_stall": row.avg_hours_before_stall,
                "intervention_sent_count": row.intervention_sent_count,
                "resumed_after_intervention_count": row.resumed_after_intervention_count,
                "re_engagement_rate_pct": row.re_engagement_rate_pct,
            }
            for row in bottlenecks
        ],
        funnel=[
            {
                "project_id": row.project_id,
                "from_stage": row.from_stage,
                "to_stage": row.to_stage,
                "users_at_from_stage": row.users_at_from_stage,
                "users_advanced": row.users_advanced,
                "advancement_rate_pct": row.advancement_rate_pct,
            }
            for row in funnel
        ],
        stalled_users=[
            {
                "user_id": row.user_id,
                "email": row.email,
                "project_id": row.project_id,
                "project_name": row.project_name,
                "journey_stage": row.journey_stage,
                "stalled_at": row.stalled_at,
                "days_stalled": row.days_stalled,
                "intervention_attempt_count": row.intervention_attempt_count,
                "last_intervention_sent_at": row.last_intervention_sent_at,
            }
            for row in stalled_users
        ],
    )


@router.get("/dashboards/stalled-users-global", status_code=status.HTTP_200_OK)
async def get_stalled_users_global(
    principal: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> dict[str, list[dict]]:
    """Get all stalled users across all projects (super-admin only).

    Shows system-wide stalled user list for ops support + outreach.
    Returns: email, project, stage, days_stalled, last_accessed, last_reminder_sent.
    Sorted by days_stalled descending (worst offenders first).
    """
    stalled_users = await get_stalled_users(conn, project_id=None, stage=None)

    return {
        "stalled_users": [
            {
                "user_id": row.user_id,
                "email": row.email,
                "project_id": row.project_id,
                "project_name": row.project_name,
                "journey_stage": row.journey_stage,
                "stalled_at": row.stalled_at,
                "days_stalled": row.days_stalled,
                "intervention_attempt_count": row.intervention_attempt_count,
                "last_intervention_sent_at": row.last_intervention_sent_at,
            }
            for row in stalled_users
        ]
    }
