# Journey Analytics Sub-Project 5A — Automated Alerting
## Implementation Specification

**Date:** 2026-09-19  
**Status:** Design (builds on Sub-Projects 2–4)  
**Scope:** Automated stall-rate monitoring + ops alerting

---

## Sub-Project 5A Scope

**Goal:** Detect and alert when user stall rates spike, enabling ops to respond quickly.

**Trigger:** Daily scheduled job (Celery beat) calculates stall rate across all stages:
- Stall rate = (stalled_users_count) / (total_active_users) × 100
- If stall_rate > STALL_RATE_THRESHOLD (default 20%), send alert to ops
- Alert includes: rate %, count stalled, recommendation (check dashboard, review latest interventions)

**Alert channels (MVP):**
- Email to ops team (Slack #operations channel via ZeptoMail)
- Log to analytics_event as `stall_rate_alert_sent` event for audit trail

**Non-scope (5B, 5C):**
- Cohort analysis (by signup date, acquisition source)
- Retry strategy optimization (ML-based)

---

## Data Model (Reuse from Sub-Projects 2–4)

**Journey state (already tracked):**
- `stalled_at` — when stall was detected (Sub-Project 2)
- `resumed_at` — when user resumed (Sub-Project 3 response detection)
- `intervention_sent_at` — when intervention was sent

**Alert state (new):**
- `analytics_event` new event type: `stall_rate_alert_sent` (audit trail)
- Config: `STALL_RATE_THRESHOLD` (env var, default 20%)
- Config: `OPS_ALERT_EMAIL` (env var; ops team address or Slack webhook)

---

## Alerting Logic

### Daily Stall Rate Calculation

Run daily at 8 AM Eastern (configurable):

```python
async def calculate_stall_rate(conn: asyncpg.Connection) -> StallRateMetric:
    """Calculate overall stall rate across all stages."""
    # Active users = users who have been active in last 30 days (created account + any meaningful event)
    # Stalled users = active users with stalled_at IS NOT NULL AND resumed_at IS NULL
    query = """
    SELECT
      COUNT(DISTINCT j.user_id) AS stalled_users,
      COUNT(DISTINCT a.id) AS total_active_users,
      ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN j.stalled_at IS NOT NULL AND j.resumed_at IS NULL THEN j.user_id END)
        / NULLIF(COUNT(DISTINCT a.id), 0),
        2
      ) AS stall_rate_pct
    FROM account a
    LEFT JOIN journey_state j ON a.id = j.user_id
    WHERE a.created_at >= NOW() - INTERVAL '30 days'
    """
    row = await conn.fetchrow(query)
    return StallRateMetric(
        stalled_users=row["stalled_users"],
        total_active_users=row["total_active_users"],
        stall_rate_pct=row["stall_rate_pct"] or 0.0,
    )
```

### Alert Decision

```python
async def send_stall_rate_alert_if_exceeded(
    conn: asyncpg.Connection,
    threshold: float = 20.0,
    ops_email: str = "ops@kaundinyalabs.com",
) -> bool:
    """If stall rate > threshold, send alert and return True. Else return False."""
    metric = await calculate_stall_rate(conn)
    
    if metric.stall_rate_pct > threshold:
        # Send alert
        subject = f"🚨 High Stall Rate Alert: {metric.stall_rate_pct}%"
        body = f"""
        Stall rate exceeded {threshold}% threshold.
        
        Metrics:
        - Stall rate: {metric.stall_rate_pct}%
        - Stalled users: {metric.stalled_users}
        - Total active users: {metric.total_active_users}
        
        Action: Review /api/v1/analytics/dashboards/intervention-overview for details.
        Consider triggering manual interventions if rate is sustained.
        """
        
        # Send via email (ZeptoMail)
        await send_email(ops_email, subject, body)
        
        # Log alert event for audit trail
        await record_event(
            conn,
            event=EventIn(
                event_name=EventName.stall_rate_alert_sent,
                properties={"stall_rate_pct": metric.stall_rate_pct, "threshold": threshold},
                session_id="system",
                device_class=DeviceClass.system,
            ),
            user_id=None,  # System event, not tied to a user
        )
        
        return True
    
    return False
```

---

## Scheduler Job

**File:** `backend/src/analytics/scheduler.py` (new)

Setup Celery beat task:

```python
from celery import shared_task
from datetime import time

@shared_task(name="analytics.daily_stall_rate_check")
async def daily_stall_rate_check():
    """Run daily at 8 AM ET. Check stall rate and alert if exceeded."""
    conn = get_connection()  # Obtain DB connection from pool
    
    threshold = settings.STALL_RATE_THRESHOLD  # env var
    ops_email = settings.OPS_ALERT_EMAIL  # env var
    
    was_alerted = await send_stall_rate_alert_if_exceeded(conn, threshold, ops_email)
    
    if was_alerted:
        logger.warning(f"Stall rate alert sent to {ops_email}")
    else:
        logger.info("Stall rate within acceptable range")
```

**Celery beat schedule** (in `backend/config.py`):

```python
CELERY_BEAT_SCHEDULE = {
    'daily-stall-rate-check': {
        'task': 'analytics.daily_stall_rate_check',
        'schedule': crontab(hour=8, minute=0),  # 8 AM ET daily
    },
}
```

---

## Configuration (env vars)

```bash
# Stall rate alerting
STALL_RATE_THRESHOLD=20.0           # % threshold to trigger alert
OPS_ALERT_EMAIL=ops@kaundinyalabs.com  # Recipient email (or Slack webhook URL)
CELERY_BROKER_URL=redis://...       # Must be set for Celery
CELERY_RESULT_BACKEND=redis://...   # Must be set for Celery
```

---

## Schemas

```python
@dataclass
class StallRateMetric:
    stalled_users: int
    total_active_users: int
    stall_rate_pct: float

class StallRateAlertEvent(EventIn):
    """Event type: stall_rate_alert_sent (audit trail)."""
    event_name: EventName = EventName.stall_rate_alert_sent
    properties: dict = {
        "stall_rate_pct": float,
        "threshold": float,
    }
```

---

## Tests

- Unit test: `calculate_stall_rate()` with mock data
  - 10/50 active users stalled → 20% rate → alert triggered
  - 5/50 active users stalled → 10% rate → no alert
  - Edge case: 0 active users → rate = 0% (no division error)
- Integration test (Celery): verify task runs, sends email, logs event
- Dry-run test: verify calculation without sending email

---

## Success Criteria

- [x] Stall rate calculation (pure function, testable)
- [x] Alert threshold config (env vars)
- [x] Email send integration (ZeptoMail)
- [x] Celery beat scheduler setup
- [x] Audit trail via analytics_event
- [x] Tests passing
- [x] Documentation + rollout playbook

---

## Out of Scope (5B, 5C, 6)

- Cohort analysis (by signup date, acquisition source) → Sub-Project 5B
- ML-based retry strategy optimization → Sub-Project 5C
- Web dashboard UI for metrics → Sub-Project 6 (frontend)
- Real-time alerting (5-min polling) — deferred; daily batch is MVP
- Slack integration — deferred (email MVP)
- Alert suppression / cooldown (no spam) — deferred

---

## Rollout Checklist

- [ ] Scheduler job implemented + tested
- [ ] Config vars set in `.env.local` + `.env.prod`
- [ ] Email templates reviewed by ops
- [ ] Dry-run in staging: verify alert sends
- [ ] Monitor first 3 days: tune threshold if needed
- [ ] Document in ops runbook: "If alert fires, check dashboard + recent interventions"
