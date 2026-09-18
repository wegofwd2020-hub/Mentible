# Journey Analytics Sub-Project 2 — Stall Detection & Intervention
## Clarification & Assumptions (for Sridhar's Review)

**Date:** 2026-09-18  
**Status:** Ready for Sridhar's feedback  
**Purpose:** Confirm stall detection rules, intervention flow, and system-level configuration scope before implementation spec is finalized.

---

## Sub-Project 2 Scope

Stall detection + intervention state machine:
- Detect when users get stuck in a journey stage
- Categorize the reason they're stuck (stall_reason)
- Track intervention state (intervention_status)
- Support configurable thresholds at system level (not per-user)

---

## Assumptions (Pending Confirmation)

### 1. Stall Detection Rules

**Time-based (per stage):**
- `discover_join` → stalled after **7 days** of no activity
- `create_first_value` → stalled after **7 days** of no meaningful action
- `refine_validate` → stalled after **10 days** (waiting for expert review response)
- `finish_pay` → stalled after **14 days** (payment incomplete)
- `return_advocate` → stalled after **21 days** (no second project created, no advocacy actions)

**Pattern-based:**
- `create_first_value` stall: **5+ generations with 0 saves/approves** = no_meaningful_action (user is looping, not committing)
- `refine_validate` stall: **invited reviewers but 0 responses after 10 days** = invite_unresponded
- `finish_pay` stall: **checkout started but not completed** = payment_incomplete
- General: **no meaningful_action_completed event for N days** in current stage

### 2. Stall Reason Categories (Enum)

```
stall_reason:
  - no_meaningful_action      # user generated content but never saved/approved
  - invite_unresponded         # invited expert reviewers, no response
  - payment_incomplete         # started checkout, abandoned
  - inactive                   # simply idle for threshold period
  - unknown                    # stall detected but reason unclear
```

### 3. Intervention State Machine

**States:**
```
intervention_status:
  - not_started               # stall detected, no action taken yet
  - in_progress               # intervention sent (email, notification, etc.)
  - completed                 # user resumed journey / unblocked
  - abandoned                 # user unresponsive after intervention attempts
```

**Proposed Flow:**
1. Stall detected → `intervention_status = not_started`, `stall_reason` populated, `stalled_at` set
2. **Question for Sridhar:** Does sub-project 2 include the actual intervention trigger (send email, etc.)?
   - **Option A:** Sub-project 2 detects + writes state only; sub-project 3 (email pipeline) handles the send
   - **Option B:** Sub-project 2 includes a trigger that invokes the email service (tight coupling)
   - **Option C:** Sub-project 2 detects + writes state; a separate scheduler job handles interventions

### 4. System-Level Configuration (Not Per-User)

All thresholds configured at **deployment time** via environment variables, not per-user settings:

```bash
# Time thresholds (days)
STALL_THRESHOLD_DISCOVER_JOIN=7
STALL_THRESHOLD_CREATE_FIRST_VALUE=7
STALL_THRESHOLD_REFINE_VALIDATE=10
STALL_THRESHOLD_FINISH_PAY=14
STALL_THRESHOLD_RETURN_ADVOCATE=21

# Pattern thresholds
STALL_GENERATION_LOOP_COUNT=5          # 5+ generations = loop
STALL_GENERATION_LOOP_ZERO_SAVES=true  # with 0 saves = stalled

# Intervention retry config
MAX_INTERVENTION_ATTEMPTS=3             # how many times to try before marking abandoned
INTERVENTION_RETRY_INTERVAL_DAYS=7      # wait 7 days between attempts
```

**No database config table at MVP** — keep it simple, environment-driven.

---

## Clarifying Questions for Sridhar

### Question 1: Intervention Scope

Does sub-project 2 include **triggering interventions** (sending emails/notifications), or just detecting stalls + writing state?

- **A:** Detection only (sub-project 2); sub-project 3 emails (recommended for MVP)
- **B:** Detection + trigger in sub-project 2
- **C:** Detection + deferred trigger (state exists, job runs later)

### Question 2: Pattern Rule Thresholds

Are the pattern rules correct? E.g.:
- 5+ generations without a save = stall?
- 10 days waiting for reviewer response = stall?
- Other patterns we should detect?

### Question 3: Stall Reason Enum

Are these stall reasons complete, or should we add others?
- `no_meaningful_action` — user generating but not committing
- `invite_unresponded` — invited reviewers, no feedback
- `payment_incomplete` — checkout abandoned
- `inactive` — simple idle time passed
- `unknown` — catch-all

### Question 4: Resume Detection

When a user resumes (meaningful action after stall), should we:
- **A:** Auto-mark `intervention_status = completed`, `stage_status = in_progress` again?
- **B:** Mark resumed state but flag it for manual review?
- **C:** Keep the stall record as-is (for analytics) but reset the journey stage?

---

## Out of Scope (Deferred to Sub-Projects 3+)

- **Sub-project 3:** Human-approved email pipeline (send interventions, track responses)
- **Sub-project 4:** Dashboards/metrics (stall analytics, intervention effectiveness)
- Per-user or per-project config (system-level only at MVP)
- Machine learning stall prediction (rule-based only)

---

## Implementation Sequence (Proposed)

1. **Sub-project 2:** Stall detection + state writes (Celery scheduled task that runs daily)
2. **Sub-project 3:** Email intervention pipeline (triggered manually or by scheduler)
3. **Sub-project 4:** Admin dashboards (stall metrics, intervention outcomes)

---

## Next Steps

Please review and confirm/adjust:
1. Time thresholds per stage
2. Pattern rules (generation loops, invite response times, etc.)
3. Stall reason categories
4. Intervention scope (question 1 — critical for planning)
5. Resume detection behavior

Once confirmed, we'll write the formal sub-project 2 spec and implementation plan.
