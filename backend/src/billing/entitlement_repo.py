"""asyncpg data access for managed entitlements (ADR-005 D6, Phase 3).

One `entitlement` row per account: the plan it holds, its status, and the current
period. The mechanism (store/read) is part of the `wegofwd-billing` extraction
candidate; the *plan catalogue* and *what a plan grants* are policy (`plans.py`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import asyncpg

# An entitlement is active only in this status; an operator (or, later, a billing
# webhook) sets past_due / canceled.
ENTITLEMENT_STATUSES = ("active", "past_due", "canceled")


@dataclass(frozen=True)
class Entitlement:
    plan_id: str
    status: str
    period_start: datetime
    period_end: datetime


def _row(row: asyncpg.Record) -> Entitlement:
    return Entitlement(
        plan_id=row["plan_id"],
        status=row["status"],
        period_start=row["period_start"],
        period_end=row["period_end"],
    )


async def get_entitlement(conn: asyncpg.Connection, *, account_id: UUID) -> Entitlement | None:
    row = await conn.fetchrow(
        "SELECT plan_id, status, period_start, period_end FROM entitlement WHERE account_id = $1",
        account_id,
    )
    return _row(row) if row else None


async def set_entitlement(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    plan_id: str,
    status: str,
    period_start: datetime,
    period_end: datetime,
) -> Entitlement:
    """Upsert the account's entitlement (one row per account)."""
    if status not in ENTITLEMENT_STATUSES:
        raise ValueError(f"unknown entitlement status: {status!r}")
    row = await conn.fetchrow(
        """
        INSERT INTO entitlement (account_id, plan_id, status, period_start, period_end)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (account_id)
            DO UPDATE SET plan_id = EXCLUDED.plan_id,
                          status = EXCLUDED.status,
                          period_start = EXCLUDED.period_start,
                          period_end = EXCLUDED.period_end,
                          updated_at = now()
        RETURNING plan_id, status, period_start, period_end
        """,
        account_id,
        plan_id,
        status,
        period_start,
        period_end,
    )
    return _row(row)


async def set_status(
    conn: asyncpg.Connection, *, account_id: UUID, status: str
) -> Entitlement | None:
    """Update only the status (keeping plan + period) — used by billing webhooks for
    expiration/billing-issue. Returns None if the account has no entitlement."""
    if status not in ENTITLEMENT_STATUSES:
        raise ValueError(f"unknown entitlement status: {status!r}")
    row = await conn.fetchrow(
        """
        UPDATE entitlement SET status = $2, updated_at = now()
         WHERE account_id = $1
        RETURNING plan_id, status, period_start, period_end
        """,
        account_id,
        status,
    )
    return _row(row) if row else None
