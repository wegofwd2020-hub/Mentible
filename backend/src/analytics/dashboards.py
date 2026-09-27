"""Dashboard query layer — measure intervention effectiveness (sub-project 4).

Pure SQL queries that aggregate journey_state + analytics_event data for metrics:
- Re-engagement rate by stall_reason
- Time-to-first-response (TTFR) distribution
- Overall response rate
- Retry effectiveness
"""

from __future__ import annotations

from dataclasses import dataclass

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


@dataclass
class StageMetricRow:
    """Stall breakdown by journey stage."""

    journey_stage: str
    total_stalled: int
    avg_time_in_stage_hours: float | None
    stall_rate_pct: float


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


@dataclass
class ProjectBottleneckRow:
    """Stall metrics by stage within a single project."""

    project_id: str
    journey_stage: str
    total_users_at_stage: int
    stalled_count: int
    stall_rate_pct: float
    avg_hours_before_stall: float | None
    intervention_sent_count: int
    resumed_after_intervention_count: int
    re_engagement_rate_pct: float | None


@dataclass
class FunnelRow:
    """Completion funnel: % advancing from stage N to N+1."""

    project_id: str
    from_stage: str
    to_stage: str
    users_at_from_stage: int
    users_advanced: int
    advancement_rate_pct: float


@dataclass
class StalledUserRow:
    """User stuck at stage in a project."""

    user_id: str
    email: str
    project_id: str
    project_name: str
    journey_stage: str
    stalled_at: str  # ISO timestamp
    days_stalled: int
    intervention_attempt_count: int
    last_intervention_sent_at: str | None


async def get_stall_by_stage(conn: asyncpg.Connection) -> list[StageMetricRow]:
    """Stall breakdown by journey stage.

    Which stages have highest dropout? How long do users stay before stalling?
    """
    query = """
    WITH stage_totals AS (
      -- Total users who reached each stage
      SELECT
        current_journey_stage,
        COUNT(*) as users_at_stage
      FROM journey_state
      GROUP BY current_journey_stage
    ),
    stage_stalls AS (
      -- Users who stalled at each stage
      SELECT
        current_journey_stage,
        COUNT(*) as stalled_count,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (stalled_at - last_meaningful_event_at))) / 3600.0,
          2
        ) as avg_hours_before_stall
      FROM journey_state
      WHERE stalled_at IS NOT NULL AND last_meaningful_event_at IS NOT NULL
      GROUP BY current_journey_stage
    )
    SELECT
      s.current_journey_stage as journey_stage,
      COALESCE(ss.stalled_count, 0) as total_stalled,
      ss.avg_hours_before_stall as avg_time_in_stage_hours,
      ROUND(
        100.0 * COALESCE(ss.stalled_count, 0) / NULLIF(st.users_at_stage, 0),
        2
      ) as stall_rate_pct
    FROM stage_totals st
    LEFT JOIN stage_stalls ss ON st.current_journey_stage = ss.current_journey_stage
    ORDER BY stall_rate_pct DESC
    """
    rows = await conn.fetch(query)
    return [StageMetricRow(**dict(r)) for r in rows]


async def get_project_bottlenecks(
    conn: asyncpg.Connection, project_id: str | None = None
) -> list[ProjectBottleneckRow]:
    """Per-project stage bottleneck analysis.

    For each stage in each project, show stall rate, intervention effectiveness, etc.
    If project_id is None, aggregate across all projects.
    """
    query = """
    WITH stage_cohorts AS (
      SELECT
        project_id,
        current_journey_stage,
        COUNT(*) as total_at_stage,
        COUNT(CASE WHEN stalled_at IS NOT NULL THEN 1 END) as stalled_count,
        COUNT(CASE WHEN intervention_sent_at IS NOT NULL THEN 1 END) as intervention_sent_count,
        COUNT(CASE WHEN customer_response_type = 'resumed_journey' THEN 1 END) as resumed_count,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (stalled_at - last_meaningful_event_at))) / 3600.0,
          2
        ) as avg_hours_before_stall
      FROM project_journey_state
      WHERE (project_id = $1 OR $1 IS NULL)
      GROUP BY project_id, current_journey_stage
    )
    SELECT
      project_id::TEXT,
      current_journey_stage as journey_stage,
      total_at_stage as total_users_at_stage,
      stalled_count,
      ROUND(
        100.0 * stalled_count / NULLIF(total_at_stage, 0),
        2
      ) as stall_rate_pct,
      avg_hours_before_stall,
      intervention_sent_count,
      resumed_count as resumed_after_intervention_count,
      ROUND(
        100.0 * resumed_count / NULLIF(intervention_sent_count, 0),
        2
      ) as re_engagement_rate_pct
    FROM stage_cohorts
    ORDER BY project_id, stall_rate_pct DESC
    """
    rows = await conn.fetch(query, project_id)
    return [ProjectBottleneckRow(**dict(r)) for r in rows]


async def get_completion_funnel(
    conn: asyncpg.Connection, project_id: str | None = None
) -> list[FunnelRow]:
    """Funnel analysis: % of users advancing from stage N to N+1.

    Shows where users drop off in the journey sequence.
    """
    # Stage order for funnel (manually defined since it's a sequence)
    stage_order = [
        "discover_join",
        "create_first_value",
        "refine_validate",
        "finish_pay",
        "return_advocate",
    ]

    query = """
    WITH stage_users AS (
      SELECT
        project_id,
        current_journey_stage,
        COUNT(DISTINCT user_id) as user_count
      FROM project_journey_state
      WHERE (project_id = $1 OR $1 IS NULL)
        AND stage_status != 'not_started'
      GROUP BY project_id, current_journey_stage
    )
    SELECT
      from_stage.project_id::TEXT,
      from_stage.current_journey_stage as from_stage,
      to_stage.current_journey_stage as to_stage,
      from_stage.user_count as users_at_from_stage,
      COALESCE(to_stage.user_count, 0) as users_advanced,
      ROUND(
        100.0 * COALESCE(to_stage.user_count, 0) / NULLIF(from_stage.user_count, 0),
        2
      ) as advancement_rate_pct
    FROM stage_users from_stage
    LEFT JOIN stage_users to_stage
      ON from_stage.project_id = to_stage.project_id
      AND to_stage.current_journey_stage = (
        CASE from_stage.current_journey_stage
          WHEN 'discover_join' THEN 'create_first_value'
          WHEN 'create_first_value' THEN 'refine_validate'
          WHEN 'refine_validate' THEN 'finish_pay'
          WHEN 'finish_pay' THEN 'return_advocate'
        END
      )
    WHERE from_stage.current_journey_stage IN ('discover_join', 'create_first_value', 'refine_validate', 'finish_pay')
    ORDER BY from_stage.project_id, from_stage.current_journey_stage
    """
    rows = await conn.fetch(query, project_id)
    return [FunnelRow(**dict(r)) for r in rows]


async def get_stalled_users(
    conn: asyncpg.Connection, project_id: str | None = None, stage: str | None = None
) -> list[StalledUserRow]:
    """List users currently stalled, optionally filtered by project + stage.

    For ops/support: "who is stuck and needs help?"
    """
    query = """
    SELECT
      pjs.user_id::TEXT,
      a.email,
      pjs.project_id::TEXT,
      p.name as project_name,
      pjs.current_journey_stage as journey_stage,
      pjs.stalled_at::TEXT,
      EXTRACT(DAY FROM NOW() - pjs.stalled_at)::INT as days_stalled,
      pjs.intervention_attempt_count,
      pjs.intervention_sent_at::TEXT
    FROM project_journey_state pjs
    JOIN account a ON pjs.user_id = a.id
    JOIN project p ON pjs.project_id = p.id
    WHERE pjs.stalled_at IS NOT NULL
      AND (pjs.project_id = $1 OR $1 IS NULL)
      AND (pjs.current_journey_stage = $2 OR $2 IS NULL)
    ORDER BY pjs.stalled_at ASC
    """
    rows = await conn.fetch(query, project_id, stage)
    return [StalledUserRow(**dict(r)) for r in rows]
