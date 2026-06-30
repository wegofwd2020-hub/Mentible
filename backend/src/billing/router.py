"""Billing webhooks — RevenueCat → entitlement (ADR-005 D6, Phase 4).

`POST /api/v1/billing/revenuecat/webhook` receives RevenueCat subscription events and
syncs the account's `entitlement` (the source of truth for managed access, Phase 3).
This replaces the manual admin grant for real subscribers.

Security: the request must carry the shared `Authorization` secret configured in the
RevenueCat dashboard (`REVENUECAT_WEBHOOK_AUTH`); checked first, constant-time. An empty
secret disables the webhook (401), so an unconfigured deploy can't be spoofed. The secret
is never logged.

Robustness: unmappable events (no plan mapping, unknown account) return 200 with a status
note rather than an error, so RevenueCat does not retry them forever; a genuine auth/server
failure is a non-2xx so RevenueCat *does* retry.
"""

from __future__ import annotations

import hmac
from datetime import UTC, datetime, timedelta

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.config import settings
from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.accounts.schemas import (
    ManagedEntitlementView,
    ManagedStatusView,
    ManagedUsageView,
)
from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans, revenuecat, usage_repo
from backend.src.db.deps import get_conn

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])
log = structlog.get_logger(__name__)

# Parsed once from config (tests monkeypatch). RevenueCat product id → our plan id.
_PRODUCT_PLAN_MAP = revenuecat.parse_product_plan_map(settings.revenuecat_product_plan_map)


def _authorized(request: Request) -> bool:
    """True iff the request carries the configured webhook secret. Empty secret ⇒ disabled."""
    expected = settings.revenuecat_webhook_auth
    if not expected:
        return False
    return hmac.compare_digest(request.headers.get("Authorization", ""), expected)


@router.get("/managed-status", response_model=ManagedStatusView)
async def get_my_managed_status(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> ManagedStatusView:
    """The caller's managed-billing status (Phase 5 client meter): entitlement (null ⇒ no
    managed plan / BYOK), the current window's server-side usage, and the plan allowance.
    With an entitlement the window is its period; otherwise a rolling window (so a staff
    user's managed usage still shows). Metadata only — no key, no content."""
    account = await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )
    ent = await entitlement_repo.get_entitlement(conn, account_id=account.id)
    if ent is not None:
        plan = plans.get_plan(ent.plan_id)
        window_start = ent.period_start
        allowance = plan.allowance_micros if plan else None
        ent_view: ManagedEntitlementView | None = ManagedEntitlementView(
            plan_id=ent.plan_id,
            plan_display=plan.display if plan else ent.plan_id,
            status=ent.status,
            period_start=ent.period_start,
            period_end=ent.period_end,
        )
    else:
        window_start = datetime.now(UTC) - timedelta(days=settings.managed_usage_window_days)
        allowance = None
        ent_view = None

    usage = await usage_repo.period_usage(conn, account_id=account.id, since=window_start)
    return ManagedStatusView(
        entitlement=ent_view,
        usage=ManagedUsageView(
            cost_micros=usage.cost_micros,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            events=usage.events,
        ),
        allowance_micros=allowance,
        window_start=window_start,
    )


@router.post("/revenuecat/webhook")
async def revenuecat_webhook(request: Request) -> dict:
    """Apply a RevenueCat subscription event to the account's entitlement."""
    # 1. Auth first — before reading the body or touching the DB.
    if not _authorized(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")

    payload = await request.json()
    intent = revenuecat.map_event(payload, _PRODUCT_PLAN_MAP)
    if intent is None:
        return {"status": "ignored"}

    pool = getattr(request.app.state, "db", None)
    if pool is None:
        # Billing requires the account store; a non-2xx makes RevenueCat retry once we're up.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="account store not configured"
        )

    async with pool.acquire() as conn:
        account = await accounts_repo.get_account(conn, idp_sub=intent.app_user_id)
        if account is None:
            # Unknown user — log + 200 so RevenueCat doesn't retry an unmappable event forever.
            log.info("revenuecat_webhook_unknown_user", event_type=intent.action)
            return {"status": "no_account"}

        async with conn.transaction():
            if intent.action == "grant":
                plan = plans.get_plan(intent.plan_id) if intent.plan_id else None
                if plan is None:
                    log.info("revenuecat_webhook_unknown_plan", plan_id=intent.plan_id)
                    return {"status": "unknown_plan"}
                now = datetime.now(UTC)
                period_end = intent.period_end or (now + timedelta(days=plan.window_days))
                await entitlement_repo.set_entitlement(
                    conn,
                    account_id=account.id,
                    plan_id=plan.id,
                    status="active",
                    period_start=now,
                    period_end=period_end,
                )
            else:  # set_status (expiration → canceled, billing issue → past_due)
                await entitlement_repo.set_status(conn, account_id=account.id, status=intent.status)

    log.info("revenuecat_webhook_applied", action=intent.action, status=intent.status)
    return {"status": "applied"}
