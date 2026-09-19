# Journey Analytics Sub-Project 2 — Stall Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-09-19-journey-analytics-sub-project-2-stall-detection.md`

**Goal:** Build stall detection engine that identifies when users get stuck in a journey stage, categorizes the reason (behavioral loop, payment abandoned, invite unresponded, timeout), and writes state (`stalled_at`, `stall_reason`, `intervention_status`) to `journey_state`. Emit no interventions (deferred to sub-project 3). Support user resume detection with audit-trail preservation. All configuration from env vars; pure, testable functions.

**Acceptance Criteria:**
- ✅ Stall detection is deterministic pure function, testable against event history
- ✅ All time thresholds and pattern rules from spec locked in
- ✅ Resume behavior preserves stall record (Option C)
- ✅ Environment-variable configuration, no database config table at MVP
- ✅ Tests pass; CI gates on new analytics coverage

---

## Task 1: Config + Schema Updates

**Files:**
- Amend: `backend/config.py`
- Amend: `backend/src/analytics/schemas.py`

**Interfaces:**
- `StallReason` enum added to schemas (values: `no_meaningful_action, invite_unresponded, payment_incomplete, inactive, unknown`)
- Config provides `stall_thresholds: dict[str, int]` (keys: `discover_join, create_first_value, refine_validate, finish_pay, return_advocate`)
- Config validates all threshold env vars present at startup; fails fast if missing

**Steps:**

- [ ] **Step 1.1: Add `StallReason` enum to `backend/src/analytics/schemas.py`**

```python
from enum import Enum

class StallReason(str, Enum):
    """Categorization of why a user's journey stalled."""
    NO_MEANINGFUL_ACTION = "no_meaningful_action"
    INVITE_UNRESPONDED = "invite_unresponded"
    PAYMENT_INCOMPLETE = "payment_incomplete"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"
```

- [ ] **Step 1.2: Update `journey_state` schema to include stall fields**

Amend the `JourneyState` model in `backend/src/analytics/schemas.py`:
```python
class JourneyStateResponse(BaseModel):
    # ... existing fields
    stalled_at: Optional[datetime] = None
    stall_reason: Optional[StallReason] = None
    intervention_status: Optional[str] = None  # will be enum in sub-project 3
    resumed_at: Optional[datetime] = None
```

- [ ] **Step 1.3: Load stall thresholds in `backend/config.py`**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # ... existing fields
    
    stall_threshold_discover_join: int = Field(..., ge=1)
    stall_threshold_create_first_value: int = Field(..., ge=1)
    stall_threshold_refine_validate: int = Field(..., ge=1)
    stall_threshold_finish_pay: int = Field(..., ge=1)
    stall_threshold_return_advocate: int = Field(..., ge=1)
    stall_generation_loop_count: int = Field(default=5, ge=1)
    stall_generation_loop_zero_saves: bool = Field(default=True)
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"
```

- [ ] **Step 1.4: Add config property to expose thresholds as a dict**

```python
@property
def stall_thresholds(self) -> dict[str, int]:
    return {
        "discover_join": self.stall_threshold_discover_join,
        "create_first_value": self.stall_threshold_create_first_value,
        "refine_validate": self.stall_threshold_refine_validate,
        "finish_pay": self.stall_threshold_finish_pay,
        "return_advocate": self.stall_threshold_return_advocate,
    }
```

- [ ] **Step 1.5: Write test for config validation**

`backend/tests/test_config_stall_thresholds.py`:
```python
import pytest
from backend.config import settings

def test_stall_thresholds_present():
    """Stall thresholds are loaded from env."""
    assert settings.stall_thresholds["discover_join"] == 7
    # ... etc for all 5 stages

def test_stall_thresholds_positive():
    """All thresholds are positive integers."""
    for stage, threshold in settings.stall_thresholds.items():
        assert threshold > 0, f"{stage} threshold must be positive"
```

---

## Task 2: Stall Detection Engine

**Files:**
- Create: `backend/src/analytics/stall.py`

**Interfaces:**
- `detect_stall(journey_state: JourneyState, events_in_stage: list[AnalyticsEvent], current_time: datetime, thresholds: dict[str, int]) -> tuple[bool, Optional[StallReason]]`
- Pure function, no DB calls, deterministic, testable

**Logic:**

1. **Get stage name** from `journey_state.current_journey_stage`
2. **Get time threshold** from `thresholds[stage_name]`
3. **Calculate inactivity duration:** `current_time - journey_state.last_meaningful_event_at`
4. **Check time-based stall:** if duration > threshold → stalled, reason = `INACTIVE`
5. **Check pattern-based stalls** (override time-based if matched):
   - For `create_first_value`: count `generation_completed` vs `meaningful_action_completed` in `events_in_stage`
     - If 5+ generations AND 0 meaningful actions → `NO_MEANINGFUL_ACTION`
   - For `refine_validate`: check if expert was invited + no reviewer responses in 10 days → `INVITE_UNRESPONDED`
   - For `finish_pay`: check if checkout was initiated but never completed → `PAYMENT_INCOMPLETE`
6. **Return** `(is_stalled=bool, stall_reason=StallReason or None)`

**Steps:**

- [ ] **Step 2.1: Create `backend/src/analytics/stall.py`**

```python
from datetime import datetime, timedelta
from typing import Optional
from backend.src.analytics.models import AnalyticsEvent, JourneyState
from backend.src.analytics.schemas import StallReason

def detect_stall(
    journey_state: JourneyState,
    events_in_stage: list[AnalyticsEvent],
    current_time: datetime,
    thresholds: dict[str, int],
) -> tuple[bool, Optional[StallReason]]:
    """
    Detect if a user is stalled in their current journey stage.
    
    Returns: (is_stalled, stall_reason)
    - is_stalled: True if any stall condition matches
    - stall_reason: Specific reason, or None if not stalled
    
    Pure function; deterministic; testable against event history.
    """
    if not journey_state.last_meaningful_event_at:
        # No events yet; can't determine stall
        return False, None
    
    stage = journey_state.current_journey_stage
    threshold_days = thresholds.get(stage)
    if not threshold_days:
        return False, None
    
    # Time-based inactivity check
    time_since_last_event = current_time - journey_state.last_meaningful_event_at
    time_threshold = timedelta(days=threshold_days)
    time_based_stall = time_since_last_event > time_threshold
    
    # Pattern-based checks
    stall_reason = _check_pattern_stalls(stage, events_in_stage, current_time, thresholds)
    
    # If pattern detected, use that; otherwise fall back to time-based
    if stall_reason:
        return True, stall_reason
    elif time_based_stall:
        return True, StallReason.INACTIVE
    else:
        return False, None


def _check_pattern_stalls(
    stage: str,
    events: list[AnalyticsEvent],
    current_time: datetime,
    thresholds: dict[str, int],
) -> Optional[StallReason]:
    """Check for behavioral patterns that indicate stall."""
    
    if stage == "create_first_value":
        return _check_generation_loop(events)
    elif stage == "refine_validate":
        return _check_invite_unresponded(events, current_time, thresholds)
    elif stage == "finish_pay":
        return _check_payment_abandoned(events)
    
    return None


def _check_generation_loop(events: list[AnalyticsEvent]) -> Optional[StallReason]:
    """Check for 5+ generations without save/approve/edit."""
    gen_count = sum(1 for e in events if e.event_name == "generation_completed")
    action_count = sum(1 for e in events if e.event_name == "meaningful_action_completed")
    
    if gen_count >= 5 and action_count == 0:
        return StallReason.NO_MEANINGFUL_ACTION
    return None


def _check_invite_unresponded(
    events: list[AnalyticsEvent],
    current_time: datetime,
    thresholds: dict[str, int],
) -> Optional[StallReason]:
    """Check for expert review invited but no response."""
    # Find "invited_for_review" event (if it exists in schema)
    invite_events = [e for e in events if e.event_name == "invited_for_review"]
    if not invite_events:
        return None
    
    # Get the most recent invite
    latest_invite = max(invite_events, key=lambda e: e.occurred_at)
    time_since_invite = current_time - latest_invite.occurred_at
    
    # Check for any reviewer responses
    response_events = [e for e in events if e.event_name == "review_completed" and e.occurred_at > latest_invite.occurred_at]
    
    if not response_events and time_since_invite > timedelta(days=10):
        return StallReason.INVITE_UNRESPONDED
    return None


def _check_payment_abandoned(events: list[AnalyticsEvent]) -> Optional[StallReason]:
    """Check for checkout started but not completed."""
    checkout_start = any(e.event_name == "checkout_started" for e in events)
    checkout_complete = any(e.event_name == "checkout_completed" for e in events)
    
    if checkout_start and not checkout_complete:
        return StallReason.PAYMENT_INCOMPLETE
    return None
```

- [ ] **Step 2.2: Write comprehensive unit tests for `detect_stall()`**

`backend/tests/test_stall_detection.py`:
```python
import pytest
from datetime import datetime, timedelta
from backend.src.analytics.stall import detect_stall
from backend.src.analytics.schemas import StallReason

def test_detect_stall_time_based_discover_join():
    """User inactive for 8 days in discover_join stage → stalled."""
    now = datetime.utcnow()
    journey = JourneyState(
        user_id=...,
        current_journey_stage="discover_join",
        last_meaningful_event_at=now - timedelta(days=8),
        ...
    )
    is_stalled, reason = detect_stall(journey, [], now, {"discover_join": 7, ...})
    assert is_stalled
    assert reason == StallReason.INACTIVE

def test_detect_stall_generation_loop():
    """User with 5+ generations and 0 saves → no_meaningful_action."""
    events = [
        AnalyticsEvent(event_name="generation_completed", ...),
        AnalyticsEvent(event_name="generation_completed", ...),
        AnalyticsEvent(event_name="generation_completed", ...),
        AnalyticsEvent(event_name="generation_completed", ...),
        AnalyticsEvent(event_name="generation_completed", ...),
    ]
    journey = JourneyState(
        current_journey_stage="create_first_value",
        last_meaningful_event_at=...,
    )
    is_stalled, reason = detect_stall(journey, events, datetime.utcnow(), {...})
    assert is_stalled
    assert reason == StallReason.NO_MEANINGFUL_ACTION

def test_no_stall_if_active():
    """User active within threshold → not stalled."""
    now = datetime.utcnow()
    journey = JourneyState(
        current_journey_stage="discover_join",
        last_meaningful_event_at=now - timedelta(days=3),
        ...
    )
    is_stalled, reason = detect_stall(journey, [], now, {"discover_join": 7, ...})
    assert not is_stalled
    assert reason is None

# ... more table-driven tests for each stage + pattern
```

---

## Task 3: Journey Evaluator Amendment

**Files:**
- Amend: `backend/src/analytics/journey.py`

**Interfaces:**
- `evaluate_journey_state()` now calls `detect_stall()` and populates stall fields in output

**Steps:**

- [ ] **Step 3.1: Import stall detection in `journey.py`**

```python
from backend.src.analytics.stall import detect_stall
from backend.src.analytics.schemas import StallReason
```

- [ ] **Step 3.2: Amend `evaluate_journey_state()` to call `detect_stall()`**

Before the return statement:
```python
def evaluate_journey_state(
    events: list[AnalyticsEvent],
    thresholds: dict[str, int],
    current_time: Optional[datetime] = None,
) -> dict:
    """..."""
    if current_time is None:
        current_time = datetime.utcnow()
    
    # ... existing logic to compute stage, stage_status, last_meaningful_event ...
    
    # Detect stall
    events_in_stage = [e for e in events if e.journey_stage == result["current_journey_stage"]]
    is_stalled, stall_reason = detect_stall(
        journey_state=...,
        events_in_stage=events_in_stage,
        current_time=current_time,
        thresholds=thresholds,
    )
    
    if is_stalled:
        result["stalled_at"] = current_time
        result["stall_reason"] = stall_reason
        result["stage_status"] = "stalled"  # Override stage_status to stalled
    
    return result
```

- [ ] **Step 3.3: Add test: stall detection integration**

`backend/tests/test_journey_stall_integration.py`:
```python
def test_journey_evaluator_detects_stall():
    """Journey evaluator calls stall detection and populates fields."""
    events = [...]  # sequence that triggers a stall
    thresholds = {"discover_join": 7, "create_first_value": 7, ...}
    
    result = evaluate_journey_state(events, thresholds)
    assert result["stage_status"] == "stalled"
    assert result["stall_reason"] == StallReason.NO_MEANINGFUL_ACTION
    assert result["stalled_at"] is not None
```

---

## Task 4: Repo Amendment

**Files:**
- Amend: `backend/src/analytics/repo.py`

**Interfaces:**
- `record_event()` calls journey-state evaluator and upsets new stall fields
- Rename internal method `_upsert_journey_state()` to handle all fields

**Steps:**

- [ ] **Step 4.1: Amend `_upsert_journey_state()` in repo**

```python
async def _upsert_journey_state(
    self,
    user_id: UUID,
    journey_fields: dict,
) -> None:
    """Upsert journey_state with all fields including stall data."""
    query = """
    INSERT INTO journey_state
        (user_id, current_journey_stage, stage_status, last_meaningful_event,
         last_meaningful_event_at, stalled_at, stall_reason, intervention_status, resumed_at)
    VALUES
        (:user_id, :current_journey_stage, :stage_status, :last_meaningful_event,
         :last_meaningful_event_at, :stalled_at, :stall_reason, :intervention_status, :resumed_at)
    ON CONFLICT (user_id) DO UPDATE SET
        current_journey_stage = EXCLUDED.current_journey_stage,
        stage_status = EXCLUDED.stage_status,
        last_meaningful_event = EXCLUDED.last_meaningful_event,
        last_meaningful_event_at = EXCLUDED.last_meaningful_event_at,
        stalled_at = COALESCE(EXCLUDED.stalled_at, journey_state.stalled_at),
        stall_reason = COALESCE(EXCLUDED.stall_reason, journey_state.stall_reason),
        intervention_status = EXCLUDED.intervention_status,
        resumed_at = EXCLUDED.resumed_at
    """
    await self.pool.execute(query, {
        "user_id": user_id,
        **journey_fields,
    })
```

- [ ] **Step 4.2: Test: stall fields round-trip through repo**

`backend/tests/test_analytics_repo_stall.py`:
```python
@pytest.mark.skipif(not DSN, reason="needs DATABASE_URL")
async def test_repo_upserts_stall_fields():
    """Stall fields are written and read back."""
    user_id = uuid4()
    
    await repo.record_event(
        user_id=user_id,
        event=AnalyticsEvent(
            event_name="generation_completed",
            ...
        ),
    )
    
    journey = await repo.get_journey_state(user_id)
    assert journey.stalled_at is not None
    assert journey.stall_reason == StallReason.NO_MEANINGFUL_ACTION
```

---

## Task 5: Tests

**Files:**
- Create/amend: `backend/tests/test_*.py` (stall-specific)

**Requirements:**
- No live Anthropic, Redis, DB in CI without `DATABASE_URL`
- Use `pytest.mark.skipif(not DSN, ...)` for DB-backed tests
- Stall detection is pure function; unit tests should not touch DB

**Steps:**

- [ ] **Step 5.1: Write schema validation test**

```python
def test_stall_reason_enum_validation():
    """StallReason enum has exactly 5 values."""
    reasons = list(StallReason)
    assert len(reasons) == 5
    assert StallReason.NO_MEANINGFUL_ACTION.value == "no_meaningful_action"
    # ... etc
```

- [ ] **Step 5.2: Write stall detection unit tests (table-driven)**

Each row tests a specific stage + pattern:
```python
@pytest.mark.parametrize("stage,events,expected_stall,expected_reason", [
    ("discover_join", [inactive_8_days], True, StallReason.INACTIVE),
    ("create_first_value", [5_generations_0_saves], True, StallReason.NO_MEANINGFUL_ACTION),
    ("refine_validate", [invite_10_days_no_response], True, StallReason.INVITE_UNRESPONDED),
    ("finish_pay", [checkout_started_not_completed], True, StallReason.PAYMENT_INCOMPLETE),
    ("create_first_value", [3_generations_2_saves], False, None),
])
def test_stall_detection(stage, events, expected_stall, expected_reason):
    ...
```

- [ ] **Step 5.3: Write integration test: resume behavior**

```python
@pytest.mark.skipif(not DSN, reason="needs DATABASE_URL")
async def test_resume_preserves_stall_record():
    """User resumes after stall; stall record retained for audit."""
    # 1. Create events that trigger stall
    # 2. Verify stalled_at + stall_reason set
    # 3. Add meaningful_action_completed event
    # 4. Re-evaluate journey state
    # 5. Assert stage_status = "in_progress", resumed_at set, BUT stalled_at + stall_reason retained
```

- [ ] **Step 5.4: Run full test suite**

```bash
cd backend
pytest tests/test_stall_detection.py -v
pytest tests/test_analytics_repo_stall.py -v
pytest --cov=backend/src/analytics -q
```

---

## Task 6: Daily Scheduler Job (Deferred — Sub-Project 2B)

**Files:**
- Create: `backend/src/analytics/tasks.py`
- Amend: `backend/main.py` or `backend/src/core/celery_app.py`

**Scope:** Plan and scope only; implementation deferred.

**Steps:**

- [ ] **Step 6.1: Draft Celery task skeleton**

```python
# backend/src/analytics/tasks.py
from celery import shared_task
import logging

@shared_task
def detect_stalls_daily():
    """Run stall detection for all active users."""
    # TODO: Fetch all active users
    # TODO: For each user, fetch events since stage entry
    # TODO: Call evaluate_journey_state() with thresholds from config
    # TODO: Write updated journey state to repo
    pass
```

- [ ] **Step 6.2: Plan beat schedule**

Celery beat will run this daily at a configured time (e.g., 2 AM UTC):
```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    "detect-stalls-daily": {
        "task": "backend.src.analytics.tasks.detect_stalls_daily",
        "schedule": crontab(hour=2, minute=0),  # 2 AM UTC
    },
}
```

- [ ] **Step 6.3: Document in ADR-031 (if needed)**

Scheduler jobs are a post-MVP addition; ADR may be helpful for reference.

---

## Pre-Flight Checks

| Check | Status |
|---|---|
| Config thresholds load at startup | [ ] |
| StallReason enum defined in schemas | [ ] |
| `detect_stall()` is pure function | [ ] |
| All tests pass, no live DB in CI | [ ] |
| Stall fields upserted via repo | [ ] |
| Resume behavior (Option C) tested | [ ] |
| No intervention sent from this module | [ ] |

---

## Success Criteria

- [x] Spec approved by Sridhar (2026-09-19)
- [ ] **Task 1:** Config + schema changes ✓
- [ ] **Task 2:** Stall detection engine ✓
- [ ] **Task 3:** Journey evaluator amended ✓
- [ ] **Task 4:** Repo amended ✓
- [ ] **Task 5:** Tests passing, coverage ≥70% ✓
- [ ] **Task 6:** Daily scheduler scoped (deferred to 2B)
- [ ] All changes committed to `main`

---

## Out of Scope (Sub-Projects 3–4)

- Sending intervention emails (sub-project 3)
- Dashboards + stall metrics (sub-project 4)
- Database config table (env vars only at MVP)
- Per-user threshold overrides

---

## Rollback Plan

If stall detection causes production issues:
1. Revert to prior commit
2. Turn off scheduler job (if deployed) via env var
3. Re-investigate with logs; no data loss (stall fields are new columns)
