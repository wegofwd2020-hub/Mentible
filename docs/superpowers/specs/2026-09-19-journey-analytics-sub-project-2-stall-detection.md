# Journey Analytics Sub-Project 2 — Stall Detection & Intervention State
## Implementation Specification

**Date:** 2026-09-19  
**Status:** Approved (Sridhar 2026-09-19)  
**Scope:** Stall detection rules, stall-reason categorization, intervention state machine, system-level configuration  

---

## Approved Design Decisions

| Question | Sridhar's Answer | Impact |
|---|---|---|
| Q1: Intervention Scope | **Option A** — Detection only; sub-project 3 (email pipeline) handles send | Backend writes state; no outbound trigger here |
| Q2: Pattern Thresholds | Example is good | Use specified thresholds (5-gen loop, 10-day invite wait, etc.) |
| Q3: Stall Reason Enum | 5 values OK | `no_meaningful_action, invite_unresponded, payment_incomplete, inactive, unknown` |
| Q4: Resume Detection | **Option C** — Keep stall record for analytics, reset journey stage | `stage_status → in_progress`, retain `stalled_at` + `stall_reason` for audit |
| System config | Works | Environment-variable-driven, no DB config table at MVP |

---

## Architecture

**New migration:** `0031` — `stall_detection_config` configuration table (future-proofing; MVP uses env vars only)

**New functions in `backend/src/analytics/`:**
- `backend/src/analytics/stall.py` — stall detection engine
  - `detect_stall(journey_state, events_since_stage_entry, thresholds) -> (is_stalled, stall_reason)`
  - Pure function; testable against event history
- `backend/src/analytics/journey.py` **amended** — existing `evaluate_journey_state()` calls stall detection
- `backend/src/analytics/repo.py` **amended** — upsert `stalled_at`, `stall_reason`, `intervention_status`

**New Celery task (deferred to sub-project 2B):**
- Daily scheduler job that runs the stall detector over all active users
- Triggered by schedule, not by event ingestion

**Configuration:**
- `backend/config.py` — loads stall thresholds from env; validates at startup

---

## Stall Detection Rules

### Time-Based (Inactivity by Stage)

| Stage | Threshold | Condition |
|---|---|---|
| `discover_join` | 7 days | No activity since stage entry |
| `create_first_value` | 7 days | No meaningful action (save/approve/edit/continue) |
| `refine_validate` | 10 days | Expert review invited; no response from reviewer |
| `finish_pay` | 14 days | Checkout initiated but not completed |
| `return_advocate` | 21 days | No second project created, no advocacy actions |

### Pattern-Based (Behavioral Loops)

| Pattern | Condition | Stall Reason |
|---|---|---|
| Generation loop (no commit) | 5+ `generation_completed` events in stage, 0 `meaningful_action_completed` | `no_meaningful_action` |
| Invite unresponded | Expert review invited, 0 reviewer responses after 10 days in `refine_validate` | `invite_unresponded` |
| Payment abandoned | `checkout_completed` never fires after `checkout_started` | `payment_incomplete` |

**Priority rule:** If **any** pattern matches, use that `stall_reason` first. Time-based `inactive` is fallback.

---

## Stall Reason Enum

```python
class StallReason(str, Enum):
    NO_MEANINGFUL_ACTION = "no_meaningful_action"
    INVITE_UNRESPONDED = "invite_unresponded"
    PAYMENT_INCOMPLETE = "payment_incomplete"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"
```

---

## Resume Behavior (Option C)

When a user resumes meaningful action after stall:
1. `stage_status` → `in_progress`
2. `last_meaningful_event` + `last_meaningful_event_at` → updated to resume event
3. `resumed_at` → set to event timestamp
4. **Retain** `stalled_at` + `stall_reason` (audit trail; sub-project 4 analytics)
5. `intervention_status` → cleared (or NULL) on resume; if intervention was sent, mark `completed`

**NOT auto-advancing the stage** — stage advancement rules from sub-project 1 remain unchanged.

---

## Configuration (Environment Variables)

```bash
# Time thresholds (days), all required at MVP
STALL_THRESHOLD_DISCOVER_JOIN=7
STALL_THRESHOLD_CREATE_FIRST_VALUE=7
STALL_THRESHOLD_REFINE_VALIDATE=10
STALL_THRESHOLD_FINISH_PAY=14
STALL_THRESHOLD_RETURN_ADVOCATE=21

# Pattern thresholds
STALL_GENERATION_LOOP_COUNT=5
STALL_GENERATION_LOOP_ZERO_SAVES=true

# Intervention config (for sub-project 3 reference)
MAX_INTERVENTION_ATTEMPTS=3
INTERVENTION_RETRY_INTERVAL_DAYS=7
```

**Validation:** All `STALL_THRESHOLD_*` variables required; fail fast at startup if missing.

---

## Implementation Sequence

### Task 1: Config + Schema
- Update `backend/config.py` to load stall thresholds
- Update `backend/src/analytics/schemas.py` with `StallReason` enum

### Task 2: Stall Detection Engine
- Write `backend/src/analytics/stall.py` with `detect_stall()` function
- Pure function, testable, no DB calls

### Task 3: Journey Evaluator Amendment
- Update `evaluate_journey_state()` in `backend/src/analytics/journey.py` to call `detect_stall()`
- Populate `stalled_at`, `stall_reason`, `stage_status` in output

### Task 4: Repo Amendment
- Update `backend/src/analytics/repo.py` to upsert new fields

### Task 5: Tests
- Schema tests: stall reason enum validation
- `detect_stall()` unit tests (table-driven by stage + pattern rules)
- Integration: stall detection + resume behavior, audit trail preservation
- No live DB in CI without `DATABASE_URL`

### Task 6: Daily Scheduler (Deferred — Phase 2)
- Celery beat job that runs stall detection daily
- Included in this spec for reference; impl pushed to sub-project 2B

---

## Out of Scope (Sub-Projects 3+)

- Sending intervention emails/notifications (sub-project 3)
- Dashboards/stall metrics (sub-project 4)
- Per-user or per-project thresholds (system-level only)
- ML-based stall prediction

---

## Non-Negotiable Rules

1. **Stall detection is a pure function.** `detect_stall()` takes events + thresholds, returns `(is_stalled, stall_reason)`. No side effects.
2. **Resume records are immutable.** If a user stalls, resumes, then stalls again, both stall records are preserved in analytics for audit.
3. **No intervention sent from this module.** State is written; sub-project 3 reads state and decides whether to send.
4. **All configuration from env at startup.** No database config table, no per-user overrides at MVP.
5. **Thresholds never change without a deploy.** Feature flags for thresholds are out of scope.

---

## Testing Requirements

- **Schema:** `StallReason` enum round-trips, validation rejects invalid values
- **Pure function:** `detect_stall()` deterministic, rebuildable from event history
- **Stage-specific rules:** Each stage's threshold is enforced independently
- **Pattern matching:** 5-gen loop + 0 saves triggers `no_meaningful_action`, etc.
- **Resume behavior:** Stalled user performs meaningful action → `stage_status` reset, `resumed_at` populated, `stall_reason` retained
- **No intervention sent:** Stall detection writes state; doesn't call any email/notification service

---

## Success Criteria

- [x] Stall reason enum locked
- [x] Pattern thresholds confirmed
- [x] Resume detection behavior locked (Option C)
- [x] System-level configuration confirmed
- [ ] Stall detection engine implemented (Task 1–4)
- [ ] Tests written + passing (Task 5)
- [ ] Daily scheduler job scoped (Task 6, deferred to 2B)
