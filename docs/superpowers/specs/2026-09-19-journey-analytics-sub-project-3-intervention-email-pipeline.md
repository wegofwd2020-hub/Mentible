# Journey Analytics Sub-Project 3 — Intervention Email Pipeline
## Implementation Specification

**Date:** 2026-09-19  
**Status:** Draft (enhancement feedback from Sridhar 2026-09-19)  
**Scope:** Send intervention emails to stalled users; track response data for Sub-Project 4 dashboards.

---

## Sub-Project 3 Scope

Build on Sub-Project 2 stall detection:
- Detect stalls ✅ (sub-project 2, done)
- **Send interventions** ← Sub-Project 3 (this spec)
- Measure effectiveness (sub-project 4 dashboards)

---

## Design Decisions

### Intervention Trigger (from Sub-Project 2 Q1, Approved Option A)

**Sub-project 2 detects stalls + writes state; sub-project 3 reads state and sends.**

- Sub-Project 2: `journey_state` = `stalled_at`, `stall_reason`, `intervention_status` = `not_started`
- Sub-Project 3: reads `intervention_status = not_started` and sends email
- No tight coupling; state-driven handoff

### Intervention Response Tracking (NEW — Sridhar 2026-09-19)

**Track customer response to intervention for re-engagement measurement.**

Five key data points:
1. **`intervention_sent_at`** — timestamp when email actually dispatched (via ZeptoMail)
2. **`customer_response_type`** — enum: `resumed_journey`, `unsubscribed`, `no_response`, `unknown`
3. **Response latency** — `resumed_at - intervention_sent_at` = TTFR (time-to-first-response)
4. **Followup events** — structured events for each response (`followup_email_sent`, `followup_email_opened`, `journey_resumed`)
5. **Effectiveness metrics** — Sub-Project 4 queries: re-engagement %, response rate by stall_reason, TTFR distribution

---

## Architecture Changes

### 1. Amend `journey_state` Table (Migration 0032)

Add three new columns:
```sql
ALTER TABLE journey_state ADD COLUMN intervention_sent_at TIMESTAMPTZ;
ALTER TABLE journey_state ADD COLUMN customer_response_type TEXT;  -- enum: resumed_journey | unsubscribed | no_response | unknown
ALTER TABLE journey_state ADD COLUMN intervention_attempt_count INT DEFAULT 0;
```

### 2. Backend Service for Email Sending

**New module:** `backend/src/analytics/intervention.py`

```python
class InterventionService:
    async def send_intervention_for_user(
        user_id: UUID,
        stall_reason: StallReason,
        email: str,
        journey_state: JourneyState,
    ) -> bool:
        """Send intervention email, update journey_state.intervention_sent_at."""
        
        # 1. Select email template by stall_reason
        template = TEMPLATES[stall_reason]
        
        # 2. Send via ZeptoMail (backend/config.py has zeptomail_token)
        # 3. Record event: followup_email_sent
        # 4. Upsert journey_state: intervention_sent_at = now, intervention_status = in_progress
        # 5. Return success/failure
```

**Template map (per stall_reason):**
- `no_meaningful_action` → "Your draft is ready—save & approve to activate"
- `invite_unresponded` → "Expert review pending—check in with reviewers"
- `payment_incomplete` → "Finish checkout to publish your content"
- `inactive` → "Welcome back! Pick up where you left off"
- `unknown` → "We noticed you've paused—we're here to help"

### 3. Intervention State Machine

**States:** `not_started` → `in_progress` → `completed` (user resumed) | `abandoned` (max retries)

**Transitions:**
- Stall detected → `intervention_status = not_started`
- Email sent → `intervention_status = in_progress`, `intervention_sent_at = now`
- User resumes (meaningful action) → `intervention_status = completed`, `customer_response_type = resumed_journey`, fire `journey_resumed` event
- Max retry attempts reached → `intervention_status = abandoned`, `customer_response_type = no_response`

### 4. Response Detection (Automatic via Events)

**Customer actions trigger events that update `customer_response_type`:**

| Event | Detected As | Action |
|---|---|---|
| `meaningful_action_completed` (after intervention_sent_at) | `resumed_journey` | Mark `intervention_status = completed` |
| User unsubscribes (future feature) | `unsubscribed` | Mark terminal state |
| No response after max_intervention_attempts retries | `no_response` | Mark `intervention_status = abandoned` |

### 5. Followup Event Types (EventName enum — already defined)

Already in the schema (Sub-Project 1):
- `INTERVENTION_SENT` — we sent an email
- `FOLLOWUP_EMAIL_SENT` — detailed followup (which template, which reason)
- `FOLLOWUP_EMAIL_DELIVERED` — ZeptoMail confirmed delivery
- `FOLLOWUP_EMAIL_FAILED` — bounce or hard error
- `JOURNEY_RESUMED` — customer resumed after intervention

**Wire these on:**
- Intervention send → `followup_email_sent` event
- ZeptoMail delivery webhook (future) → `followup_email_delivered`
- User meaningful_action after intervention → fire `journey_resumed`

---

## Implementation Sequence

### Task 1: Migration + Schema
- Create Migration 0032: add `intervention_sent_at`, `customer_response_type`, `intervention_attempt_count`
- Add `CustomerResponseType` enum to models.py

### Task 2: Intervention Service
- Build `intervention.py` with `send_intervention_for_user()`
- Email template system (templates by stall_reason)
- ZeptoMail integration (using existing config)

### Task 3: Event Emission
- Wire `followup_email_sent` event on email send
- Wire `journey_resumed` event when user meaningful_action fires (after intervention_sent_at)
- Auto-detect `customer_response_type` on resume

### Task 4: State Machine
- Update `upsert_journey_state()` to handle `intervention_sent_at`, `customer_response_type`
- Implement retry logic: max_intervention_attempts + retry_interval_days

### Task 5: Endpoint
- `POST /api/v1/analytics/interventions/send-stalled` — manual trigger (gated on super-admin for MVP)
- Takes user_id, optional override stall_reason
- Returns success/failure + email sent result

### Task 6: Tests
- Unit tests: email template selection
- Integration tests: state transitions (not_started → in_progress → completed)
- Resume detection: meaningful_action sets customer_response_type = resumed_journey

### Task 7: Scheduler (Deferred to 3B)
- Celery beat job: daily scan for `intervention_status = not_started`, attempt send
- Retry logic: `intervention_attempt_count < max_intervention_attempts`
- Mark `abandoned` after max retries

---

## Response Measurement (Sub-Project 4 Input)

**Queries Sub-Project 4 dashboards will run:**

```sql
-- Re-engagement rate by stall reason
SELECT 
  stall_reason,
  COUNT(CASE WHEN customer_response_type = 'resumed_journey' THEN 1 END)::FLOAT / COUNT(*) as re_engagement_rate
FROM journey_state
WHERE intervention_sent_at IS NOT NULL
GROUP BY stall_reason;

-- Time-to-first-response (TTFR) distribution
SELECT 
  stall_reason,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resumed_at - intervention_sent_at) as median_ttfr,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY resumed_at - intervention_sent_at) as p95_ttfr
FROM journey_state
WHERE customer_response_type = 'resumed_journey' AND intervention_sent_at IS NOT NULL
GROUP BY stall_reason;

-- Response rate (any response vs silence)
SELECT
  COUNT(CASE WHEN customer_response_type IN ('resumed_journey', 'unsubscribed') THEN 1 END)::FLOAT / COUNT(*) as response_rate
FROM journey_state
WHERE intervention_sent_at IS NOT NULL;
```

---

## Non-Negotiable Rules

1. **Email never fails the primary operation.** Stall detection and journey state update happen regardless of ZeptoMail success. Log send failures as structured warnings (key-redacted).
2. **No unilateral email without review at MVP.** Manual super-admin trigger only; scheduler (3B) requires additional product approval.
3. **Response is customer-detected, not server-pushed.** Intervention sent via email; customer response detected via their meaningful_action event (event-driven, not polling).
4. **Audit trail: intervention_sent_at is immutable.** Once set, never overwritten (even if retry fails). Retry count stored separately.
5. **Customer-response-type is set once and final.** Once detected, don't change. Allows Sub-Project 4 to reason about response cohorts.

---

## Out of Scope (Sub-Projects 3B, 4, 5+)

- Scheduler trigger (Celery beat job, deferred to 3B)
- ZeptoMail delivery webhook (email tracking)
- A/B testing email templates (future optimization)
- SMS/push notification alternatives (channel expansion)
- Dashboards (sub-project 4)
- ML-based send timing optimization

---

## Testing

- Schema validation: `intervention_sent_at` nullable, `customer_response_type` enum round-trips
- Email send: template selection by stall_reason, ZeptoMail call, event emission
- State transitions: not_started → in_progress on send, → completed on resume
- Resume detection: meaningful_action after intervention_sent_at sets customer_response_type = resumed_journey
- No live ZeptoMail in CI; mock at boundary

---

## Success Criteria

- [x] Sub-Project 2 done (stall detection)
- [ ] Migration 0032 (new columns)
- [ ] InterventionService + templates
- [ ] Event emission (followup_email_sent, journey_resumed)
- [ ] State machine + retry logic
- [ ] Manual super-admin endpoint
- [ ] Tests pass (email, state, resume detection)
- [ ] Sub-Project 4 can query re-engagement metrics

---

## Next: Sub-Project 4 (Dashboards)

Measure effectiveness:
- Re-engagement % by stall reason (which interventions work?)
- TTFR distribution (how fast do users return?)
- Response rate (how many see the email?)
- Retry effectiveness (do retries help or hurt?)

Design dashboards for ops team + product leadership.
