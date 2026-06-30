"""asyncpg data access for managed usage metering (ADR-005 D6, Phase 2).

Append a `usage_event` per managed generation; read the current-window total as a
SUM aggregate over (account_id, ts). The mechanism (store + rollup read) is part of
the `wegofwd-billing` extraction candidate; the cap *policy* that consumes the total
lives in `caps.py`. Scoped by `account_id` like the rest of the account store
(CLAUDE.md rule 4 — no RLS).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import asyncpg


@dataclass(frozen=True)
class PeriodUsage:
    """A rolled-up usage total for one account over a time window."""

    input_tokens: int
    output_tokens: int
    cost_micros: int
    events: int


@dataclass(frozen=True)
class TotalUsage:
    """Aggregate managed usage across ALL accounts over a window (admin margin view)."""

    cost_micros: int
    events: int
    accounts: int


async def record_usage(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_micros: int,
    job_id: UUID,
) -> None:
    """Append one managed-generation usage row. Counts + cost only — no key, no content."""
    await conn.execute(
        """
        INSERT INTO usage_event
            (account_id, provider, model, input_tokens, output_tokens, cost_micros, job_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        account_id,
        provider,
        model,
        input_tokens,
        output_tokens,
        cost_micros,
        job_id,
    )


async def period_usage(
    conn: asyncpg.Connection, *, account_id: UUID, since: datetime
) -> PeriodUsage:
    """Sum an account's usage from `since` to now. Zero when there are no events."""
    row = await conn.fetchrow(
        """
        SELECT COALESCE(sum(input_tokens), 0)  AS input_tokens,
               COALESCE(sum(output_tokens), 0) AS output_tokens,
               COALESCE(sum(cost_micros), 0)   AS cost_micros,
               count(*)                        AS events
          FROM usage_event
         WHERE account_id = $1 AND ts >= $2
        """,
        account_id,
        since,
    )
    return PeriodUsage(
        input_tokens=int(row["input_tokens"]),
        output_tokens=int(row["output_tokens"]),
        cost_micros=int(row["cost_micros"]),
        events=int(row["events"]),
    )


async def total_usage(conn: asyncpg.Connection, *, since: datetime) -> TotalUsage:
    """Aggregate managed spend across all accounts from `since` to now (margin monitoring)."""
    row = await conn.fetchrow(
        """
        SELECT COALESCE(sum(cost_micros), 0) AS cost_micros,
               count(*)                      AS events,
               count(DISTINCT account_id)    AS accounts
          FROM usage_event
         WHERE ts >= $1
        """,
        since,
    )
    return TotalUsage(
        cost_micros=int(row["cost_micros"]),
        events=int(row["events"]),
        accounts=int(row["accounts"]),
    )
