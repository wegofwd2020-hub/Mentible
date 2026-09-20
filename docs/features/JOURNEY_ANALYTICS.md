# Journey Analytics: Stall Detection & Alerting

**Status:** ✅ Live on Production (2026-09-20, commit ac58b73)  
**Deployed:** Mentible backend + Celery Beat scheduler  
**Owner:** Engineering (Siva Mambakkam)

---

## Overview

Journey Analytics is an automated **user engagement monitoring** system. It tracks user activity across the Mentible app and detects when users become inactive (stalled), then alerts ops for intervention.

**Four sub-projects:**
1. **Stall Detection Engine** — Identifies inactive users (no meaningful action for 7+ days)
2. **Intervention Email Pipeline** — Sends re-engagement emails to stalled users
3. **Dashboards & Metrics** — Real-time visibility into stall rates and intervention effectiveness
4. **Automated Stall-Rate Alerting** — Daily 8 AM ET email to ops if stall rate exceeds 20%

---

## Features

### 1. Stall Detection

Tracks user journey through discrete stages:
- `signup` → `onboarded` → `create_first_value` → `generate_first_lesson` → `view_lesson` → `sustained_use`

**Stall markers:**
- No meaningful action for 7+ days
- Detects 4 stall reasons: `no_signup`, `no_auth_activity`, `no_meaningful_action`, `unknown`

**Database:** `journey_state` table (one row per user)

### 2. Intervention Pipeline

When a stalled user is detected:
- Email sent with re-engagement CTA + quick onboarding refresh
- Tracks: `intervention_status` (not_started / in_progress / responded)
- Records: `customer_response_type` (resumed_journey / unsubscribed / no_response / unknown)
- Retry logic: up to 3 attempts over 14 days

**Endpoint:** `POST /api/v1/analytics/interventions/send-stalled` (super-admin only)

### 3. Dashboards

**Endpoint:** `GET /api/v1/analytics/dashboards/intervention-overview` (super-admin only)

**Metrics:**
- **Re-engagement rate** — % of stalled users who resumed (by stall_reason)
- **TTFR (Time-to-First-Response)** — How fast users respond to interventions
- **Response rate** — % of stalled users who received an email + responded
- **Retry effectiveness** — Does retry #2 work better than retry #1?

**Response format:**
```json
{
  "re_engagement": [
    {
      "stall_reason": "no_meaningful_action",
      "resumed_count": 5,
      "total_stalled": 20,
      "rate_pct": 25.0
    }
  ],
  "ttfr": [
    {
      "bucket_hours": 24,
      "count": 3
    }
  ],
  "response_rate": {
    "responded": 8,
    "total_sent": 15,
    "rate_pct": 53.3
  },
  "retry_effectiveness": [
    {
      "attempt": 1,
      "response_rate_pct": 45.0
    }
  ]
}
```

### 4. Automated Daily Alert

**Runs:** 8 AM ET every day (Celery Beat)  
**Trigger:** Stall rate > 20% (configurable via `STALL_RATE_THRESHOLD`)  
**Recipient:** `ops@kaundinyalabs.com` (configurable via `OPS_ALERT_EMAIL`)

**Email subject:** `🚨 High Stall Rate Alert: 25.0%`

**Email body:**
- Stall rate %
- Stalled user count
- Total active users (last 30 days)
- Link to dashboard
- CTA: "Consider triggering manual interventions"

**Logged to:** `analytics_event` table with `event_name='stall_rate_alert_sent'`

---

## How to Access

### Dashboard (Super-Admin Only)

```bash
# On prod server, verify super-admin access
curl -H "Authorization: Bearer $SUPABASE_JWT" \
  http://127.0.0.1:8092/api/v1/analytics/dashboards/intervention-overview
```

**Web app:** Not yet in UI — raw API endpoint only (2026-09-20).

### Send Interventions (Super-Admin Only)

```bash
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8092/api/v1/analytics/interventions/send-stalled \
  -d '{"dry_run": false}'
```

### View Audit Trail

```bash
# Check which stalled users got interventions (Postgres)
psql -U postgres -h $DATABASE_URL -d mentible

SELECT 
  user_id, 
  stalled_at, 
  intervention_sent_at, 
  customer_response_type,
  intervention_attempt_count
FROM journey_state 
WHERE stalled_at IS NOT NULL
ORDER BY stalled_at DESC
LIMIT 10;
```

### Configuration

Set in `.env.demo` on prod server (no rebuild needed):

```bash
# Stall-rate alert threshold (%)
STALL_RATE_THRESHOLD=20.0

# Alert recipient email
OPS_ALERT_EMAIL=ops@kaundinyalabs.com

# ZeptoMail (required for emails to send)
ZEPTOMAIL_TOKEN=<your-zoho-token>
ZEPTOMAIL_FROM=feedback@kaundinyalabs.com
FEEDBACK_TO=support@kaundinyalabs.com
```

---

## Deployment

**Live as of:** 2026-09-20 (commit ac58b73)

**Prod services:**
- `mentible-api` — Generates journey state, serves dashboard endpoint
- `mentible-celery-worker` — Executes intervention send tasks
- `mentible-celery-beat` — Runs 8 AM ET daily stall-rate check

**Database migrations:**
- `0030` — journey_state table + indexes
- `0031` — analytics_event audit trail
- `0032` — intervention status + attempt tracking
- `0033` — stall_reason enum

All migrations applied automatically on startup (Alembic).

---

## Troubleshooting

### Alert didn't fire (but rate should be high)

1. Verify Celery Beat is running:
   ```bash
   docker ps | grep celery-beat
   ```

2. Check if task is registered:
   ```bash
   docker logs mentible-celery-beat | grep "daily_stall_rate_check"
   ```

3. Verify threshold in .env.demo:
   ```bash
   grep STALL_RATE_THRESHOLD /opt/mentible/.env.demo
   ```

### Email not received

1. Check event was logged:
   ```bash
   SELECT * FROM analytics_event 
   WHERE event_name = 'stall_rate_alert_sent' 
   ORDER BY occurred_at DESC LIMIT 1;
   ```

2. Verify ZeptoMail token is valid (Zoho dashboard)

3. Check spam folder (first alert may land there)

### High false positive rate

Increase threshold in `.env.demo`:
```bash
STALL_RATE_THRESHOLD=25.0  # or higher
```

Then restart API + Beat:
```bash
docker compose -f docker-compose.demo.yml --env-file .env.demo restart api celery-beat
```

---

## Metrics to Monitor

**Baseline (rolling 30-day):**
- Current stall rate: % of active users stalled
- Avg intervention response time: hours to respond
- Reactivation rate: % resumed after intervention

**Thresholds:**
- Healthy: 0–19% stall rate
- Watch: 20–30%
- Alert: 30–50%
- Critical: 50%+

---

## Next Steps (Deferred)

- **Dashboard UI** — Render metrics in web app (mobile + web)
- **Cohort analysis** — Segment stalled users by acquisition source / plan
- **ML retry optimization** — Learn best timing for retry #2 vs #3
- **Slack integration** — Post alerts to #operations channel
- **Alert cooldown** — Suppress duplicate alerts within 24 hours

---

## Links

- **Spec:** `docs/superpowers/specs/2026-09-19-journey-analytics-sub-project-5a-alerting.md`
- **Ops Runbook:** `docs/ops/STALL_RATE_ALERTING_RUNBOOK.md`
- **Staging Plan:** `docs/plans/STAGING_VALIDATION_JOURNEY_ANALYTICS.md`
- **Backend Code:** `backend/src/analytics/` (alerting, dashboards, journey_state repos)
- **Config:** `backend/config.py` (STALL_RATE_THRESHOLD, OPS_ALERT_EMAIL, Celery Beat schedule)

---

**Last Updated:** 2026-09-20  
**Maintainers:** Engineering + Ops
