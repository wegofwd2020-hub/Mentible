"""Managed access decision — per-app POLICY (ADR-005 D6, Phase 3).

Answers, for one managed request, "may this account generate on provider P, and what is
its remaining allowance?" — unifying eligibility and the cost cap that the Phase-2
`caps.py` handled. Two sources, checked in order:

1. **Plan entitlement (the real path):** an `active` entitlement whose period covers now
   and whose plan (`plans.py`) lists the provider. The cap is the plan's allowance over
   the entitlement period.
2. **Staff allowlist (dev / dogfood override):** the Phase-1 internal allowlist
   (`eligibility.is_managed_eligible`). Kept so internal use needs no entitlement row (and
   so the no-DB managed path still works); the cap is the fixed `MANAGED_PERIOD_COST_CAP_MICROS`
   over a rolling window.

`resolve_managed_access` returns None when neither applies (⇒ the request is refused). The
cap is read against `usage_repo` (Phase 2 metering). Allowance 0 ⇒ uncapped.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import asyncpg

from backend.config import settings
from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans, usage_repo
from backend.src.billing.eligibility import is_managed_eligible


@dataclass(frozen=True)
class ManagedAccess:
    """The resolved managed grant for one request."""

    allowance_micros: int  # cost cap for `since`..now; 0 = unlimited
    since: datetime  # window start the cap is measured from
    source: str  # a plan id, or "staff"


async def resolve_managed_access(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    provider_id: str,
    principal: Principal | None,
) -> ManagedAccess | None:
    """The account's managed grant for `provider_id`, or None if not eligible."""
    now = datetime.now(UTC)

    # 1. Plan entitlement.
    ent = await entitlement_repo.get_entitlement(conn, account_id=account_id)
    if ent is not None and ent.status == "active" and ent.period_start <= now < ent.period_end:
        plan = plans.get_plan(ent.plan_id)
        if plan is not None and provider_id in plan.managed_providers:
            return ManagedAccess(plan.allowance_micros, ent.period_start, plan.id)

    # 2. Staff allowlist override (dev / dogfood).
    if is_managed_eligible(principal, provider_id):
        window_start = now - timedelta(days=settings.managed_usage_window_days)
        return ManagedAccess(settings.managed_period_cost_cap_micros, window_start, "staff")

    return None


async def over_cap(conn: asyncpg.Connection, *, account_id: UUID, access: ManagedAccess) -> bool:
    """True iff the account has met or exceeded `access`'s allowance for its window.
    Always False for an unlimited allowance (0)."""
    if access.allowance_micros <= 0:
        return False
    usage = await usage_repo.period_usage(conn, account_id=account_id, since=access.since)
    return usage.cost_micros >= access.allowance_micros
