"""Alerting layer — stall rate monitoring & ops notifications (sub-project 5A).

Daily scheduled job calculates stall rate; alerts ops if threshold exceeded.
"""

from __future__ import annotations

import logging
import structlog
from dataclasses import dataclass
from uuid import uuid4

import asyncpg
import httpx

from backend.config import settings
from backend.src.analytics.models import DeviceClass, EventName
from backend.src.analytics.repo import record_event
from backend.src.analytics.schemas import EventIn

logger = logging.getLogger(__name__)
struct_logger = structlog.get_logger()


@dataclass
class StallRateMetric:
    """Stall rate across all active users."""

    stalled_users: int
    total_active_users: int
    stall_rate_pct: float


async def calculate_stall_rate(
    conn: asyncpg.Connection, days_active: int = 30
) -> StallRateMetric:
    """Calculate overall stall rate across all active users.

    Active users = accounts created within `days_active` days.
    Stalled users = active users with stalled_at IS NOT NULL AND resumed_at IS NULL.

    Args:
        conn: asyncpg connection
        days_active: window (days) to consider user "active" (default 30)

    Returns:
        StallRateMetric with stalled_users, total_active_users, stall_rate_pct
    """
    query = """
    SELECT
      COUNT(DISTINCT CASE WHEN j.stalled_at IS NOT NULL AND j.resumed_at IS NULL THEN j.user_id END)::INT
        as stalled_users,
      COUNT(DISTINCT a.id)::INT as total_active_users,
      ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN j.stalled_at IS NOT NULL AND j.resumed_at IS NULL THEN j.user_id END)
        / NULLIF(COUNT(DISTINCT a.id), 0),
        2
      )::FLOAT as stall_rate_pct
    FROM account a
    LEFT JOIN journey_state j ON a.id = j.user_id
    WHERE a.created_at >= NOW() - INTERVAL '1 day' * %s
    """
    row = await conn.fetchrow(query, days_active)

    if not row:
        return StallRateMetric(stalled_users=0, total_active_users=0, stall_rate_pct=0.0)

    return StallRateMetric(
        stalled_users=row["stalled_users"] or 0,
        total_active_users=row["total_active_users"] or 0,
        stall_rate_pct=row["stall_rate_pct"] or 0.0,
    )


async def send_stall_rate_alert_if_exceeded(
    conn: asyncpg.Connection,
    threshold: float = 20.0,
    ops_email: str = "ops@kaundinyalabs.com",
    days_active: int = 30,
) -> bool:
    """If stall rate > threshold, send alert email and log event. Return True if alerted.

    Args:
        conn: asyncpg connection
        threshold: stall rate % threshold (default 20%)
        ops_email: recipient email address
        days_active: window (days) to consider user "active"

    Returns:
        True if alert was sent (rate exceeded threshold), False otherwise

    Side effects (if alerted):
    - Sends email via ZeptoMail
    - Logs `stall_rate_alert_sent` event for audit trail
    - Errors in email/logging are caught and logged (don't fail primary operation)
    """
    metric = await calculate_stall_rate(conn, days_active=days_active)

    if metric.stall_rate_pct <= threshold:
        # Rate within acceptable range; no alert needed
        return False

    # Rate exceeded threshold — send alert
    subject = f"🚨 High Stall Rate Alert: {metric.stall_rate_pct}%"
    body = f"""
Stall rate exceeded {threshold}% threshold.

Metrics (last {days_active} days):
- Stall rate: {metric.stall_rate_pct}%
- Stalled users: {metric.stalled_users}
- Total active users: {metric.total_active_users}

Action: Review /api/v1/analytics/dashboards/intervention-overview for details.
Consider triggering manual interventions if rate is sustained.

---
Automated alert from Mentible Journey Analytics (Sub-Project 5A)
"""

    # Send email via ZeptoMail
    send_success = False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.zeptomail_base_url}/email",
                headers={
                    "Authorization": settings.zeptomail_token,
                },
                json={
                    "from": {"address": settings.zeptomail_from, "name": "Mentible Ops"},
                    "to": [{"email_address": {"address": ops_email}}],
                    "subject": subject,
                    "textbody": body,
                    "reply_to": {"address": settings.feedback_to},
                },
            )
            send_success = resp.status_code == 200
            if send_success:
                logger.info(f"Stall rate alert email sent to {ops_email}")
            else:
                logger.warning(
                    f"ZeptoMail returned {resp.status_code} for stall rate alert: {resp.text[:200]}"
                )
    except Exception as e:
        # Log warning but don't crash; ops will check manually
        logger.warning(f"Failed to send stall rate alert email: {e}", exc_info=True)

    # Log event for audit trail
    try:
        event = EventIn(
            event_id=uuid4(),
            event_name=EventName.stall_rate_alert_sent,
            occurred_at=None,  # Uses default (now)
            anonymous_id=None,
            session_id="system-scheduler",
            project_id=None,
            journey_stage=None,
            use_case=None,
            content_type=None,
            plan_id=None,
            acquisition_source=None,
            device_class=DeviceClass.system,
            experiment_variant=None,
            success=True,
            error_code=None,
            duration_ms=None,
            properties={
                "stall_rate_pct": metric.stall_rate_pct,
                "threshold": threshold,
                "stalled_users": metric.stalled_users,
                "total_active_users": metric.total_active_users,
                "ops_email": ops_email,
            },
        )
        await record_event(conn, event=event, user_id=None)
        logger.info("Stall rate alert event logged")
    except Exception as e:
        # Log warning but don't crash
        logger.warning(f"Failed to log stall rate alert event: {e}", exc_info=True)

    return True
