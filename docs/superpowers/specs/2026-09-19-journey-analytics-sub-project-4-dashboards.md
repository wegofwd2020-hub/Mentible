# Journey Analytics Sub-Project 4 — Dashboards & Metrics
## Implementation Specification

**Date:** 2026-09-19  
**Status:** Draft (built on Sub-Projects 2 & 3)  
**Scope:** Measure intervention effectiveness via dashboards for ops + product leadership.

---

## Sub-Project 4 Scope

Build on Sub-Projects 2 & 3:
- Sub-Project 2: Detect stalls ✅
- Sub-Project 3: Send interventions + track response ✅
- **Sub-Project 4: Measure effectiveness** ← This spec

Answer key questions:
1. **Re-engagement rate** — which stall reasons have highest recovery?
2. **TTFR (time-to-first-response)** — how fast do users return after intervention?
3. **Response rate** — what % of users respond at all?
4. **Retry effectiveness** — do retries help or fatigue?

---

## Data Model (from Sub-Projects 2 & 3)

**`journey_state` columns used:**
- `stalled_at` — when stall detected
- `stall_reason` — enum: no_meaningful_action, invite_unresponded, payment_incomplete, inactive, unknown
- `intervention_sent_at` — when email sent (Sub-3)
- `customer_response_type` — enum: resumed_journey, unsubscribed, no_response, unknown (Sub-3)
- `resumed_at` — when user resumed (from last_meaningful_event_at after stall)
- `intervention_attempt_count` — how many retries (Sub-3)

**`analytics_event` table:**
- `followup_email_sent`, `followup_email_delivered`, `followup_email_failed` — track email lifecycle
- `journey_resumed` — user resumed after intervention

---

## Core Metrics (SQL Queries)

### 1. Re-engagement Rate by Stall Reason

```sql
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
ORDER BY re_engagement_rate_pct DESC;
```

### 2. Time-to-First-Response (TTFR) Distribution

```sql
SELECT 
  stall_reason,
  COUNT(*) as responded_count,
  ROUND(
    EXTRACT(EPOCH FROM (resumed_at - intervention_sent_at)) / 3600
  ) as ttfr_hours,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY resumed_at - intervention_sent_at) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY resumed_at - intervention_sent_at) as p95
FROM journey_state
WHERE customer_response_type = 'resumed_journey' 
  AND intervention_sent_at IS NOT NULL
GROUP BY stall_reason;
```

### 3. Response Rate (Any Response vs Silence)

```sql
SELECT 
  COUNT(CASE WHEN customer_response_type IN ('resumed_journey', 'unsubscribed') THEN 1 END)::FLOAT 
    / COUNT(*) as response_rate,
  COUNT(CASE WHEN customer_response_type = 'no_response' THEN 1 END) as no_response_count,
  COUNT(*) as total_interventions
FROM journey_state
WHERE intervention_sent_at IS NOT NULL;
```

### 4. Retry Effectiveness

```sql
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
ORDER BY intervention_attempt_count;
```

---

## Dashboard Components

### Admin Dashboard (Super-Admin Only)

**Page 1: Intervention Overview**
- Re-engagement rate by stall_reason (table + bar chart)
- Overall response rate (pie: responded vs silent)
- Median TTFR (hours, by stall_reason)

**Page 2: Response Behavior**
- TTFR distribution (histogram: when do users return?)
- Response type breakdown (pie: resumed_journey vs unsubscribed vs no_response)
- Retry effectiveness table (attempt_count vs success rate)

**Page 3: Cohort Analysis**
- Date-based cohorts (intervention_sent_at)
- Stall reason distribution
- Re-engagement trend over time (line chart)

**Page 4: Incident/Anomaly**
- Outliers: users who stalled but never responded (red flag)
- Users who unsubscribed (after intervention?)
- Interventions that failed to send (email bounces)

### Ops Dashboard (Incident Response)

**Page 1: Health Check**
- Total stalled users (today, this week, all-time)
- Interventions sent (success %, send errors)
- Latest failures (last 10 interventions that failed)

**Page 2: User Segments**
- Stall reason distribution (pie chart)
- Stage distribution (which stage has most stalls?)
- Top reasons for no response

---

## Implementation Sequence

### Task 1: Query Layer
- Create `backend/src/analytics/dashboards.py` with dashboard query functions
- Queries: re_engagement_by_reason, ttfr_distribution, response_rate, retry_effectiveness
- Minimal business logic; mostly SQL

### Task 2: API Endpoints
- `GET /api/v1/analytics/dashboards/intervention-overview` — super-admin gated
- Returns structured JSON for charts (re_engagement, response_rate, ttfr_p50, etc)
- Response schema: `DashboardResponse` pydantic model

### Task 3: Web Frontend (Separate from Backend)
- Dashboard UI in `web/` (outside scope of this backend spec, but mentioned for completeness)
- Charts: recharts, plotly, or similar
- Pages: overview, response behavior, cohort analysis, health check

### Task 4: Tests
- Query tests: mock data → verify metrics calculations
- Endpoint tests: super-admin access control
- No live DB in CI; seed test data via fixtures

### Task 5: Performance Optimization
- Index on `journey_state(intervention_sent_at, stall_reason, customer_response_type)`
- Cache dashboard queries (5-min TTL)
- Batch queries to avoid N+1

---

## Success Criteria

- [x] Sub-Projects 2 & 3 done (stall detect + send interventions)
- [ ] Query layer (`dashboards.py`) built with 4 core metric queries
- [ ] API endpoints (super-admin gated) return structured JSON
- [ ] Tests passing (query correctness, access control)
- [ ] Performance: <500ms query latency at 100k stalled users
- [ ] Ready for web UI team to consume

---

## Out of Scope (Sub-Project 5+)

- Web UI/visualization (separate frontend work)
- Real-time dashboards (5-min cache is MVP)
- ML-based predictions (future optimization)
- User-level drill-down (ops-level aggregate only at MVP)
- Alerting/webhooks (escalation logic)

---

## Non-Negotiable Rules

1. **Super-admin access only.** No self-serve metrics (D20 — single privileged operator tier).
2. **No PII in response.** Queries aggregate across users; never return individual names/emails.
3. **Audit trail.** Log dashboard views + exports (optional in 4.2+).
4. **Query performance.** All dashboards < 1s latency; add indexes proactively.
5. **Data staleness.** 5-min cache is acceptable (not real-time); document it.

---

## Next: Sub-Project 5+ (Deferred)

- **5A:** Automated alerting (stall rate > 20%)
- **5B:** Cohort analysis (by signup date, acquisition source)
- **5C:** Retry strategy optimization (ML-suggested retry intervals)
- **6:** Web UI dashboard (frontend work)
