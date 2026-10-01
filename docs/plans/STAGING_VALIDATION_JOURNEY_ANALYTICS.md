# Staging Validation — Journey Analytics (Sub-Projects 2–5A)
## Pre-Production Verification Plan

**Date:** 2026-09-19  
**Scope:** Sub-Projects 2, 3, 4, 5A (stall detection → interventions → dashboards → alerting)  
**Target:** Verify all systems work together end-to-end before prod rollout

---

## Pre-Deployment Checklist

- [ ] All 4 sub-project commits merged to main (85b6d35)
- [ ] CI/CD green (all tests passing)
- [ ] Staging environment is clean (or rollback plan ready)
- [ ] Database backups taken (pre-migration)
- [ ] Ops team notified (alerting will be live after deploy)

---

## Deployment Steps

### 1. Deploy to Staging

```bash
# On the staging VPS
cd /opt
./mentible_vps_deploy.sh

# Verify API container is healthy
docker compose -f docker-compose.demo.yml ps
# api should show "Up" status

# Check logs for startup errors
docker compose -f docker-compose.demo.yml logs api | tail -50
```

**Expected:** API, Redis, Postgres all up. Alembic migrations 0030–0033 applied successfully.

### 2. Verify Database Migrations

```bash
# SSH into staging DB container
docker compose -f docker-compose.demo.yml exec db psql -U postgres -d mentible

# Check journey_state table has all stall + intervention columns
\d journey_state

# Verify column names: stalled_at, stall_reason, intervention_status,
# intervention_sent_at, customer_response_type, intervention_attempt_count
```

**Expected:**
- `stalled_at` (timestamp, nullable)
- `stall_reason` (text, nullable)
- `intervention_status` (text, default 'not_started')
- `intervention_sent_at` (timestamp, nullable)
- `customer_response_type` (text, nullable)
- `intervention_attempt_count` (int, default 0)

### 3. Verify Celery Worker + Beat

```bash
# Check Celery worker is running
docker compose -f docker-compose.demo.yml logs celery_worker | tail -20

# Check Celery beat is running
docker compose -f docker-compose.demo.yml logs celery_beat | tail -20

# Verify task is registered
docker compose -f docker-compose.demo.yml exec celery_worker \
  celery -A backend.celery_app inspect registered | grep daily_stall_rate_check
```

**Expected:**
- Worker logs show "connected to Redis"
- Beat logs show "Starting scheduler"
- Task `analytics.daily_stall_rate_check` appears in registered tasks

---

## Functional Validation

### Test 1: Journey State Upsert

**Goal:** Verify stall detection pipeline works.

```bash
# Create a test account
curl -X POST http://staging.app/api/v1/accounts/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test-stall@staging.local", "password": "testpass123"}'

# Get test user ID from DB
docker compose exec db psql -U postgres -d mentible \
  -c "SELECT id FROM account WHERE email = 'test-stall@staging.local';"

# Record an event that marks stall
curl -X POST http://staging.app/api/v1/analytics/events \
  -H "Authorization: Bearer <test-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "event_name": "book_created",
    "journey_stage": "create_first_value",
    "session_id": "test-session",
    "device_class": "web",
    "occurred_at": "2026-09-19T00:00:00Z"
  }'

# Query journey_state
docker compose exec db psql -U postgres -d mentible \
  -c "SELECT user_id, current_journey_stage, stalled_at FROM journey_state WHERE user_id = '<test-user-id>';"
```

**Expected:** journey_state row created with `current_journey_stage = create_first_value`.

### Test 2: Dashboard Endpoint (Super-Admin Only)

**Goal:** Verify dashboard metrics query works.

```bash
# Get super-admin token from staging (or use test admin account)
# Curl the dashboard endpoint
curl -X GET http://staging.app/api/v1/analytics/dashboards/intervention-overview \
  -H "Authorization: Bearer <super-admin-token>"

# Should return JSON with structure:
# {
#   "re_engagement": [...],
#   "ttfr": [...],
#   "response_rate": {...},
#   "retry_effectiveness": [...]
# }
```

**Expected:** 200 response with aggregated metrics (may be empty if no data yet).

### Test 3: Stall Rate Calculation

**Goal:** Verify stall-rate calculation works.

```bash
# Manually trigger the Celery task (dry-run first)
docker compose exec celery_worker \
  celery -A backend.celery_app call analytics.daily_stall_rate_check

# Check task result in Redis (or logs)
docker compose logs celery_worker | grep "daily_stall_rate_check"
```

**Expected:** Task completes (no errors in logs).

### Test 4: Alert Send (Manual Trigger)

**Goal:** Verify alert email is sent when threshold exceeded.

```bash
# Set threshold very low in staging to guarantee alert
docker compose exec api bash -c "export STALL_RATE_THRESHOLD=0.1 && \
  python3 -c 'from backend.src.analytics.alerting import send_stall_rate_alert_if_exceeded; \
  import asyncio; \
  from backend.src.db.pool import get_connection; \
  conn = get_connection(); \
  result = asyncio.run(send_stall_rate_alert_if_exceeded(conn, threshold=0.1)); \
  print(result)'"

# Check email was sent (check ZeptoMail dashboard or staging email inbox)
# Verify event was logged
docker compose exec db psql -U postgres -d mentible \
  -c "SELECT event_name, properties FROM analytics_event WHERE event_name = 'stall_rate_alert_sent' ORDER BY occurred_at DESC LIMIT 1;"
```

**Expected:**
- Email received at OPS_ALERT_EMAIL (or staging mailbox)
- Event logged in analytics_event table with stall_rate_pct in properties

### Test 5: Intervention Endpoint (Sub-Project 3)

**Goal:** Verify intervention send workflow still works.

```bash
# Create a stalled user (manually set stalled_at in DB)
docker compose exec db psql -U postgres -d mentible -c "
UPDATE journey_state SET 
  stalled_at = NOW() - INTERVAL '8 days',
  stall_reason = 'no_meaningful_action',
  intervention_status = 'not_started'
WHERE user_id = '<test-user-id>';
"

# Trigger interventions endpoint (super-admin only)
curl -X POST http://staging.app/api/v1/analytics/interventions/send-stalled \
  -H "Authorization: Bearer <super-admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": false}'

# Verify intervention_sent_at was set
docker compose exec db psql -U postgres -d mentible \
  -c "SELECT intervention_sent_at, customer_response_type FROM journey_state WHERE user_id = '<test-user-id>';"
```

**Expected:**
- Email sent to test user
- intervention_sent_at updated in DB
- followup_email_sent event logged

---

## Performance Validation

### Dashboard Query Latency

```bash
# Time the dashboard endpoint
time curl -X GET http://staging.app/api/v1/analytics/dashboards/intervention-overview \
  -H "Authorization: Bearer <super-admin-token>"
```

**Target:** < 500 ms (with index on journey_state).

### Stall Rate Calculation Latency

```bash
# Time the stall-rate function
docker compose exec celery_worker time python3 -c "
from backend.src.analytics.alerting import calculate_stall_rate
import asyncio
from backend.src.db.pool import get_connection
conn = get_connection()
metric = asyncio.run(calculate_stall_rate(conn))
print(metric)
"
```

**Target:** < 1 second (single query on journey_state).

---

## Data Validation

### Journey State Integrity

```bash
# Query sample journey_state rows
docker compose exec db psql -U postgres -d mentible -c "
SELECT 
  user_id, 
  current_journey_stage,
  stalled_at,
  stall_reason,
  intervention_sent_at,
  customer_response_type,
  intervention_attempt_count
FROM journey_state 
LIMIT 5;
"
```

**Expected:**
- Rows have consistent data (stalled_at not null only if stall_reason is set)
- intervention_sent_at not null only if intervention_status = 'in_progress'
- customer_response_type values are in enum (resumed_journey, unsubscribed, no_response, unknown)

### Analytics Event Audit Trail

```bash
# Query all events related to journey analytics
docker compose exec db psql -U postgres -d mentible -c "
SELECT event_name, COUNT(*) FROM analytics_event 
WHERE event_name IN ('stall_detected', 'stall_rate_alert_sent', 'followup_email_sent', 'journey_resumed')
GROUP BY event_name;
"
```

**Expected:**
- Event counts make sense (stall_rate_alert_sent = number of times alert fired)

---

## Smoke Test Suite (Automated)

```bash
# Run all analytics tests in staging
docker compose exec api pytest backend/tests/test_stall_detection.py \
  backend/tests/test_journey_stall_integration.py \
  backend/tests/test_intervention_service.py \
  backend/tests/test_dashboards.py \
  backend/tests/test_alerting.py \
  -v

# Expected: 56+ tests pass (all unit tests)
```

---

## Rollback Plan

If staging validation fails:

1. **Stop the alert job** (prevent spam):
   ```bash
   docker compose exec celery_beat kill <beat-process-id>
   ```

2. **Revert to previous version**:
   ```bash
   mv /opt/mentible /opt/mentible-broken-85b6d35
   mv /opt/mentible-old-<TIMESTAMP> /opt/mentible
   docker compose up -d --remove-orphans
   # Rollback DB if migrations were destructive (migrations 0030–0033 are additive, safe)
   ```

3. **Notify team** and post-mortem in #engineering

---

## Success Criteria

- [ ] All 4 sub-project commits deployed to staging
- [ ] Database migrations 0030–0033 applied successfully
- [ ] Celery worker + beat running without errors
- [ ] Dashboard endpoint returns metrics (< 500 ms)
- [ ] Stall-rate calculation works (< 1 s)
- [ ] Alert email sent successfully (manual trigger)
- [ ] Intervention flow still works end-to-end
- [ ] All 56+ tests pass
- [ ] Journey state data is consistent
- [ ] Audit trail (analytics_event) captures all key events
- [ ] Smoke test suite green
- [ ] Ops team confirmed alert mailbox working

---

## Sign-Off

Once all checks pass:

- [ ] **QA:** Validation complete, no blockers
- [ ] **Ops:** Alert flow verified, runbook ready
- [ ] **Engineering:** Code review + merge to main (already done)
- [ ] **Product:** Aware of new metrics + dashboard access

**Approved for production deploy:** _______________  
**Date:** _______________

---

## Next Steps (Post-Validation)

1. **Production Deployment** — Follow mentible_vps_deploy.sh on prod server
2. **Prod Smoke Test** — Same validations as staging, on production data
3. **Monitor First 24 Hours** — Watch Celery logs, alert email, dashboard metrics
4. **Scale to Other Projects** — Journey analytics can now power reports for product + ops
