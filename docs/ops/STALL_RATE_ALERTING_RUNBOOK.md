# Stall-Rate Alerting Runbook
## Journey Analytics Sub-Project 5A

**Date:** 2026-09-19  
**Maintainer:** Ops + Engineering

---

## Overview

**What:** Daily automated stall-rate monitoring via Celery scheduler (8 AM ET).  
**Why:** Early warning system for user drop-off. When stall rate exceeds threshold (default 20%), an alert email is sent to ops with actionable metrics.  
**Where:** Backend Celery beat task `analytics.daily_stall_rate_check()`. Audit trail logged to `analytics_event` table.

---

## Alert Email Anatomy

**Subject:** `🚨 High Stall Rate Alert: 25.0%`

**Body includes:**
- Stall rate % (25%, 30%, etc.)
- Count stalled users
- Total active users (last 30 days)
- Link: "Review /api/v1/analytics/dashboards/intervention-overview for details"
- CTA: "Consider triggering manual interventions if rate is sustained"

**Recipient:** `ops@kaundinyalabs.com` (configurable via `OPS_ALERT_EMAIL`)

---

## When Alert Fires

### Interpretation

| Rate | Status | Action |
|---|---|---|
| 0–19% | ✅ Healthy | No action; monitor |
| 20–30% | ⚠️ Watch | Review dashboard; check recent interventions |
| 30–50% | 🔴 Alert | Escalate; review recent changes (feature/bug/external?) |
| 50%+ | 🚨 Critical | Page on-call immediately; engage product/eng |

### Root Causes to Check

1. **Feature Launch** → New flow is confusing (e.g., checkout, auth redesign)
   - Action: Check app changelog; review recent deploys
   - Remedy: Revert feature or hot-fix UX issue

2. **Bug or Outage** → Generation, payment, or core flow broken
   - Action: Check error logs; review incident channel
   - Remedy: Fix and re-deploy

3. **External Dependency** → API/vendor down (Anthropic, payment processor, etc.)
   - Action: Check status pages; ping integrations team
   - Remedy: Wait for service recovery or failover

4. **Seasonal/Expected** → Holiday, marketing campaign, or known retention cliff
   - Action: Cross-check against marketing calendar
   - Remedy: None if expected; adjust threshold temporarily if recurring

5. **Threshold Too Low** → 20% is too aggressive for your user base
   - Action: Review historical rates; consult product
   - Remedy: Adjust `STALL_RATE_THRESHOLD` env var (docs below)

---

## Response Checklist

When alert fires:

- [ ] **Read the email:** Note the rate %, stalled count, and timestamp
- [ ] **Check dashboard:** Visit `/api/v1/analytics/dashboards/intervention-overview`
  - Review re-engagement rate by stall_reason (which reasons are highest?)
  - Check TTFR (time-to-first-response) — are interventions effective?
  - Scan retry effectiveness — do retries help or hurt?
- [ ] **Review recent changes:** Check git log, deploys, and feature flags (last 24 hours)
- [ ] **Check error logs:** Search for spikes in generation, payment, or auth errors
- [ ] **Determine root cause:** Is it a code issue, external dependency, or expected pattern?
- [ ] **Take action:**
  - Bug found → Fix + deploy (test in staging first)
  - External outage → Wait + monitor + communicate
  - Threshold too low → Tune env var (see Tuning, below)
  - Seasonal/expected → Document in Slack #operations; adjust threshold if recurring
- [ ] **Verify recovery:** Check dashboard again 2–4 hours later. Rate should drop.

---

## Tuning the Threshold

**Current setting:** `STALL_RATE_THRESHOLD=20.0` (20%)

### If Alert is Too Noisy

**Symptom:** Alert fires weekly despite no user-facing issues.

**Action:** Increase threshold in `.env.prod`:
```bash
STALL_RATE_THRESHOLD=25.0  # or 30.0 for more permissive
```

**Consideration:** Only increase if you understand *why* the rate is that high. A sustained 25% stall rate is still a business problem; don't silence the alarm, fix the underlying cause.

### If Alert is Too Silent

**Symptom:** Users are churning but alert doesn't fire.

**Action:** Decrease threshold:
```bash
STALL_RATE_THRESHOLD=15.0  # or 10.0 for more sensitive
```

**Consideration:** Lower threshold = more false positives. Balance with ops time budget.

### Historical Baseline

Track the rolling 30-day stall rate in your monitoring dashboard (TBD: add to Grafana). Threshold should be **above your baseline, below true crisis** (e.g., if baseline is 10%, threshold of 20% is reasonable).

---

## Environment Variables

### Required at Deploy

```bash
# .env.prod (secrets manager)

# Stall-rate threshold (%)
STALL_RATE_THRESHOLD=20.0

# Alert recipient email
OPS_ALERT_EMAIL=ops@kaundinyalabs.com

# Celery broker (already required; used by scheduler)
CELERY_BROKER_URL=redis://...

# Celery result backend (already required)
CELERY_RESULT_BACKEND=redis://...

# ZeptoMail (already required for intervention emails; reused for alert)
ZEPTOMAIL_TOKEN=... (from Zoho account)
ZEPTOMAIL_FROM=feedback@kaundinyalabs.com
ZEPTOMAIL_BASE_URL=https://api.zeptomail.com/v1.1
FEEDBACK_TO=support@kaundinyalabs.com  (for alert reply-to)
```

### Verify After Deploy

```bash
# On the backend server, check config loads
python3 -c "from backend.config import settings; print(f'Threshold: {settings.stall_rate_threshold}%'); print(f'Email: {settings.ops_alert_email}')"

# Check Celery can discover the task
celery -A backend.celery_app inspect active_queues
# Should show: task 'analytics.daily_stall_rate_check' registered
```

---

## Email Template

**Verify with ZeptoMail team before launch:**

- Subject is clear and actionable (🚨 emoji helps in email clients)
- Reply-to address is monitored (currently `support@kaundinyalabs.com`)
- `from` address is ZeptoMail-verified (currently `feedback@kaundinyalabs.com`)
- Plain text is readable (no HTML markup issues)

**Current template:**

```
Subject: 🚨 High Stall Rate Alert: <rate>%

Stall rate exceeded <threshold>% threshold.

Metrics (last 30 days):
- Stall rate: <rate>%
- Stalled users: <count>
- Total active users: <total>

Action: Review /api/v1/analytics/dashboards/intervention-overview for details.
Consider triggering manual interventions if rate is sustained.

---
Automated alert from Mentible Journey Analytics (Sub-Project 5A)
```

---

## Dry-Run Checklist (Before Production)

**Goal:** Verify alert fires, sends email, and logs event without affecting prod users.

### In Staging

- [ ] Deploy to staging (`git deploy-staging`)
- [ ] Set `STALL_RATE_THRESHOLD` to a very low value (e.g., 0.1%) to guarantee alert
- [ ] Manually trigger Celery task:
  ```bash
  celery -A backend.celery_app call analytics.daily_stall_rate_check
  ```
- [ ] Verify email received at `OPS_ALERT_EMAIL` (check spam folder)
- [ ] Verify event logged: Query `analytics_event` table for `stall_rate_alert_sent` event
- [ ] Check logs for warnings/errors (should be clean)
- [ ] Reset `STALL_RATE_THRESHOLD` to production value (20%)
- [ ] Test again with current rates (should NOT fire unless rate truly >20%)

### Pre-Production (in Prod, but with dry_run=true)

- [ ] Deploy to production
- [ ] Set `STALL_RATE_THRESHOLD` to low value in prod (0.1%)
- [ ] Manually call task via Celery:
  ```bash
  celery -A backend.celery_app call analytics.daily_stall_rate_check
  ```
- [ ] Verify email landed at prod ops email
- [ ] Verify event in prod `analytics_event` table
- [ ] Reset `STALL_RATE_THRESHOLD` to 20%
- [ ] Communicate to ops team: "Alerting is live; you'll see the first alert at 8 AM ET tomorrow"

---

## Monitoring & Maintenance

### Daily (Automated)

- Celery beat runs at 8 AM ET every day
- If rate > threshold, email + event logged (best-effort; errors don't crash the scheduler)
- Email delivery is not guaranteed (depends on ZeptoMail uptime)

### Weekly (Manual Check)

- Check `analytics_event` table for `stall_rate_alert_sent` events (audit trail)
- Review any alerts that fired; note root cause in Slack #operations thread
- If threshold was adjusted, document why

### Monthly

- Review stall rate trend (rolling 30-day baseline)
- Assess whether threshold is still appropriate
- Update runbook if procedures change

---

## Troubleshooting

### Alert Didn't Fire (But Rate Should Be High)

**Check:**
1. Celery beat is running: `ps aux | grep celery`
2. Redis is up: `redis-cli ping` should return PONG
3. Config loaded correctly: `python3 -c "from backend.config import settings; print(settings.stall_rate_threshold)"`
4. Log for errors: `grep "daily_stall_rate_check" /var/log/mentible/backend.log`

**Fix:**
- Restart Celery worker: `systemctl restart celery-worker celery-beat`
- Check Redis connection string in `.env.prod`

### Email Not Received

**Check:**
1. Event was logged: Query `analytics_event WHERE event_name = 'stall_rate_alert_sent'`
2. Check ZeptoMail logs (Zoho dashboard)
3. Check spam folder (first alert might land there)

**Fix:**
- Verify `OPS_ALERT_EMAIL` is correct
- Verify ZeptoMail token is valid (may have expired or rotated)
- Ask ZeptoMail support if `feedback@kaundinyalabs.com` is still verified

### False Positives (Alert Fires, But No Real Issue)

**Likely cause:** Threshold too low, or a seasonal user behavior.

**Fix:** Increase threshold or document as expected (see Tuning section above).

---

## Escalation Path

| Scenario | Action | Escalate To |
|---|---|---|
| Rate 20–30%, no obvious cause | Review dashboard; check recent changes | Engineering |
| Rate 30–50%, features/bugs suspected | Revert suspected feature or hot-fix | Eng + Product |
| Rate 50%+, or sustained 30%+ for 2+ hours | Page on-call | On-call Engineer |
| Email not sent but rate is high | Check Celery logs; verify ZeptoMail | DevOps + Eng |

---

## Links & References

- **Dashboard:** `/api/v1/analytics/dashboards/intervention-overview` (super-admin only)
- **Spec:** `docs/superpowers/specs/2026-09-19-journey-analytics-sub-project-5a-alerting.md`
- **Config:** `backend/config.py` (STALL_RATE_THRESHOLD, OPS_ALERT_EMAIL)
- **Code:** `backend/src/analytics/alerting.py` (alert logic)
- **Scheduler:** `backend/src/analytics/scheduler.py` (Celery task)
- **Audit Trail:** `analytics_event` table, `event_name='stall_rate_alert_sent'`

---

## Questions?

Contact: Engineering (Siva Mambakkam) or DevOps  
Slack: #operations
