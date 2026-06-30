"""Managed plans — per-app POLICY (ADR-005 D6, Phase 3; ADR-019: plan defs stay per-app).

A small, code-defined registry of the plans an account can be entitled to. Plans rarely
change and are product-shaped (Mentible's allowance/providers differ from Pramana's), so
they live in code here, not a shared table. Each plan declares its **allowance** (a cost
cap in micro-USD over the entitlement period; 0 ⇒ unlimited) and which **providers** it
covers managed. The `entitlement` row (DB) records *which* plan an account holds and its
period; this module says *what* each plan grants.

Real billing (Phase 4) maps payment-processor products → these plan ids; until then an
operator grants an entitlement directly.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    id: str
    display: str
    allowance_micros: int  # cost cap per period in micro-USD; 0 = unlimited
    managed_providers: frozenset[str]  # providers this plan may generate managed
    window_days: int  # entitlement period length when granted


# Phase 3 starter set (Anthropic-only managed, per ADR-005 O4). Tune freely — these are
# policy. `allowance_micros` is illustrative until real pricing/packaging is set.
_PLANS: dict[str, Plan] = {
    "managed_basic": Plan(
        id="managed_basic",
        display="Managed Basic",
        allowance_micros=5_000_000,  # $5.00 of managed tokens per 30-day period
        managed_providers=frozenset({"anthropic"}),
        window_days=30,
    ),
    "managed_unlimited": Plan(
        id="managed_unlimited",
        display="Managed Unlimited",
        allowance_micros=0,  # uncapped by allowance (the O7 spend ceiling still backstops)
        # Multi-provider (Phase 6). Gemini is omitted by default — managed Gemini needs a
        # PAID key (free tier trains on data, O4); add it to a plan deliberately.
        managed_providers=frozenset({"anthropic", "openai", "groq"}),
        window_days=30,
    ),
}


def get_plan(plan_id: str) -> Plan | None:
    """The plan with this id, or None if unknown."""
    return _PLANS.get(plan_id)


def plan_ids() -> frozenset[str]:
    """All known plan ids (e.g. to validate an admin grant)."""
    return frozenset(_PLANS)
