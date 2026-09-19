"""Dashboard query layer — measure intervention effectiveness (sub-project 4).

Pure SQL queries that aggregate journey_state + analytics_event data for metrics:
- Re-engagement rate by stall_reason
- Time-to-first-response (TTFR) distribution
- Overall response rate
- Retry effectiveness
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

import asyncpg


@dataclass
class ReEngagementRow:
    """Re-engagement rate by stall reason."""
    stall_reason: str
    total_stalled: int
    resumed: int
    re_engagement_rate_pct: float


@dataclass
class TTFRRow:
    """Time-to-first-response distribution."""
    stall_reason: str
    responded_count: int
    p50_seconds: int | None
    p95_seconds: int | None


@dataclass
class ResponseRateMetric:
    """Overall response rate (any response vs silence)."""
    response_rate: float
    no_response_count: int
    total_interventions: int


@dataclass
class RetryEffectivenessRow:
    """Retry effectiveness — success rate by attempt number."""
    attempt_count: int
    attempts_made: int
    resumed: int
    success_rate_pct: float


async def get_re_engagement_by_reason(conn: asyncpg.Connection) -> list[ReEngagementRow]:
    """Re-engagement rate by stall_reason.

    Which stall reasons have highest recovery?
    """
    query = """
    SELECT
      stall_reason,
      COUNT(*) as total_stalled,
      COUNT(CASE WHEN customer_response_type = 'resumed_journey' THEN 1 END) as resumed,
      ROUND(
        100.0 * COUNT(CASE WHEN customer_response_type = 'resumed_journey' THEN 1 END)
        / NULLIF(COUNT(*), 0),
        2
      ) as re_engagement_rate_pct
    FROM journey_state
    WHERE stalled_at IS NOT NULL
    GROUP BY stall_reason
    ORDER BY re_engagement_rate_pct DESC
    """
    rows = await conn.fetch(query)
    return [ReEngagementRow(**dict(r)) for r in rows]


async def get_ttfr_distribution(conn: asyncpg.Connection) -> list[TTFRRow]:
    """Time-to-first-response (TTFR) distribution.

    How long does it take for users to resume after intervention?
    Returns p50 (median) and p95 latency in seconds.
    """
    query = """
    SELECT
      stall_reason,
      COUNT(*) as responded_count,
      EXTRACT(EPOCH FROM PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY resumed_at - intervention_sent_at))::INT as p50_seconds,
      EXTRACT(EPOCH FROM PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY resumed_at - intervention_sent_at))::INT as p95_seconds
    FROM journey_state
    WHERE customer_response_type = 'resumed_journey'
      AND intervention_sent_at IS NOT NULL
      AND resumed_at IS NOT NULL
    GROUP BY stall_reason
    ORDER BY p50_seconds DESC
    """
    rows = await conn.fetch(query)
    return [TTFRRow(**dict(r)) for r in rows]


async def get_response_rate(conn: asyncpg.Connection) -> ResponseRateMetric:
    """Overall response rate (any response vs silence).

    What % of users respond to intervention at all (resumed_journey or unsubscribed)?
    """
    query = """
    SELECT
      COUNT(CASE WHEN customer_response_type IN ('resumed_journey', 'unsubscribed') THEN 1 END)::FLOAT
        / NULLIF(COUNT(*), 0) as response_rate,
      COUNT(CASE WHEN customer_response_type = 'no_response' THEN 1 END) as no_response_count,
      COUNT(*) as total_interventions
    FROM journey_state
    WHERE intervention_sent_at IS NOT NULL
    """
    row = await conn.fetchrow(query)
    if row:
        return ResponseRateMetric(**dict(row))
    return ResponseRateMetric(response_rate=0.0, no_response_count=0, total_interventions=0)


async def get_retry_effectiveness(conn: asyncpg.Connection) -> list[RetryEffectivenessRow]:
    """Retry effectiveness — success rate by attempt number.

    Do retries help? (Decreasing success rate suggests fatigue.)
    """
    query = """
    SELECT
      intervention_attempt_count,
      COUNT(*) as attempts_made,
      COUNT(CASE WHEN customer_response_type = 'resumed_journey' THEN 1 END) as resumed,
      ROUND(
        100.0 * COUNT(CASE WHEN customer_response_type = 'resumed_journey' THEN 1 END)
        / NULLIF(COUNT(*), 0),
        2
      ) as success_rate_pct
    FROM journey_state
    WHERE intervention_attempt_count > 0
    GROUP BY intervention_attempt_count
    ORDER BY intervention_attempt_count
    """
    rows = await conn.fetch(query)
    return [RetryEffectivenessRow(**dict(r)) for r in rows]
