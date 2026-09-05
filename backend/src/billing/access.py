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
import structlog

from backend.config import settings
from backend.src.accounts import repo as accounts_repo
from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans, usage_repo
from backend.src.billing.eligibility import is_managed_eligible, is_staff_allowlisted
from backend.src.billing.vault import get_managed_stt_key

log = structlog.get_logger(__name__)


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


async def resolve_managed_stt_access(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    provider_id: str,
    principal: Principal | None,
) -> ManagedAccess | None:
    """The account's managed grant for an STT `provider_id`, or None if not eligible.

    STT providers (e.g. sarvam) are offered managed via the STT key set
    (`get_managed_stt_key`), NOT the LLM plan `managed_providers` list — a
    text-gen plan never lists an STT-only engine. So STT eligibility is: the
    provider has a configured managed STT key, AND the account is Pro (an active
    entitlement) or on the staff allowlist. Mirrors `resolve_managed_access`'s
    grant shape so `over_cap` works unchanged.
    """
    if get_managed_stt_key(provider_id) is None:
        return None

    now = datetime.now(UTC)

    # 1. Any active plan entitlement grants managed STT (provider availability is
    #    already ensured by the STT-key check above — STT isn't per-plan-provider).
    ent = await entitlement_repo.get_entitlement(conn, account_id=account_id)
    if ent is not None and ent.status == "active" and ent.period_start <= now < ent.period_end:
        plan = plans.get_plan(ent.plan_id)
        if plan is not None:
            return ManagedAccess(plan.allowance_micros, ent.period_start, plan.id)

    # 2. Staff allowlist override (dev / dogfood).
    if principal is not None and is_staff_allowlisted(sub=principal.sub, email=principal.email):
        window_start = now - timedelta(days=settings.managed_usage_window_days)
        return ManagedAccess(settings.managed_period_cost_cap_micros, window_start, "staff")

    return None


async def is_pro(conn: asyncpg.Connection, *, account_id: UUID) -> bool:
    """Pro = an active managed entitlement OR the staff allowlist — the single,
    **provider-agnostic** gate for Free/Pro feature gating (T1 foundation; not the
    per-provider `resolve_managed_access`, which needs a `provider_id` and a
    configured managed key for that provider). An account with an active
    entitlement for ANY provider, or one whose IdP sub/email is on the internal
    managed-staff allowlist, is Pro regardless of which provider it actually uses.
    """
    now = datetime.now(UTC)
    ent = await entitlement_repo.get_entitlement(conn, account_id=account_id)
    if ent is not None and ent.status == "active" and ent.period_start <= now < ent.period_end:
        return True

    account = await accounts_repo.get_account_by_id(conn, account_id=account_id)
    if account is not None and is_staff_allowlisted(sub=account.idp_sub, email=account.email):
        return True

    return False


async def account_features(conn: asyncpg.Connection, *, account_id: UUID) -> frozenset[str]:
    """The capability flags this account holds: its active plan's `features`, OR the
    full export set for a staff-allowlisted account, else empty. Mirrors `is_pro`'s
    active-window + staff-allowlist logic exactly, but returns the granted flag set
    instead of a bool (T-P0-3 — the per-feature entitlement axis)."""
    now = datetime.now(UTC)
    ent = await entitlement_repo.get_entitlement(conn, account_id=account_id)
    if ent is not None and ent.status == "active" and ent.period_start <= now < ent.period_end:
        plan = plans.get_plan(ent.plan_id)
        if plan is not None:
            return plan.features

    account = await accounts_repo.get_account_by_id(conn, account_id=account_id)
    if account is not None and is_staff_allowlisted(sub=account.idp_sub, email=account.email):
        return plans.EXPORT_FEATURES

    return frozenset()


async def has_feature(conn: asyncpg.Connection, *, account_id: UUID, feature: str) -> bool:
    """True iff the account's active plan (or the staff allowlist) grants `feature`."""
    return feature in await account_features(conn, account_id=account_id)


async def over_cap(conn: asyncpg.Connection, *, account_id: UUID, access: ManagedAccess) -> bool:
    """True iff the request should be refused on cost grounds — over the plan allowance OR
    over the hard per-account spend ceiling (Phase 6, O7), whichever binds.

    The **ceiling** is a backstop that bounds OUR spend even on an unlimited plan or the
    staff override, against a runaway client. Also emits an ops **anomaly alarm** when the
    account crosses a warn fraction of its effective limit. Truly unlimited (no allowance,
    no ceiling) ⇒ never blocked, and the usage row isn't even read."""
    allowance = access.allowance_micros
    ceiling = settings.managed_account_spend_ceiling_micros
    if allowance <= 0 and ceiling <= 0:
        return False

    usage = await usage_repo.period_usage(conn, account_id=account_id, since=access.since)
    cost = usage.cost_micros

    # The binding limit is the smaller of the two that apply (each > 0).
    effective = min(x for x in (allowance, ceiling) if x > 0)
    frac = settings.managed_spend_alarm_fraction
    if frac > 0 and cost >= int(effective * frac):
        log.warning(
            "managed_spend_alarm",
            account_id=str(account_id),
            cost_micros=cost,
            effective_limit_micros=effective,
            source=access.source,
        )

    over_allowance = allowance > 0 and cost >= allowance
    over_ceiling = ceiling > 0 and cost >= ceiling
    if over_ceiling and not over_allowance:
        log.warning(
            "managed_spend_ceiling_hit",
            account_id=str(account_id),
            cost_micros=cost,
            ceiling_micros=ceiling,
            source=access.source,
        )
    return over_allowance or over_ceiling
