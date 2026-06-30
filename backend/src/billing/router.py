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

import structlog
from fastapi import APIRouter, HTTPException, Request, status

from backend.config import settings
from backend.src.accounts import repo as accounts_repo
from backend.src.billing import entitlement_repo, plans, revenuecat

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
