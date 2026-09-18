# Journey Analytics — Event Schema & Journey-State Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the analytics event schema, ingestion path, and journey-state evaluator that
sub-projects 2–4 (stall detection, email pipeline, dashboards) will read from — plus wire the
first server-confirmed event (`signup_completed`) end-to-end as the reference pattern for the
follow-up plan that wires the remaining 6 call sites.

**Architecture:** New `backend/src/analytics/` module, asyncpg raw-SQL repo layer (matching the
codebase's existing pattern in `backend/src/feedback/`, `backend/src/billing/` — **not**
SQLAlchemy; the design doc's mention of "SQLAlchemy models" is corrected here to match backend
rule #6, "asyncpg for Postgres"). Two tables (`analytics_event` append-only, `journey_state`
upserted), a pure `evaluate_journey_state()` function, a batched ingestion endpoint for
client-originated events, and in-process `record_event()` calls at server-confirmed outcomes.

**Tech Stack:** FastAPI, asyncpg, Pydantic, pytest (DSN-skipif pattern, no live DB in CI without
`DATABASE_URL`), alembic (raw-SQL migrations).

**Spec:** `docs/superpowers/specs/2026-09-18-journey-analytics-instrumentation-design.md`

## Global Constraints

- Canonical event names, enum values, and field names are preserved **verbatim** from the
  source doc (`Mentible_User_Journey_Analytics_Build_Specification.docx` v1.2) — never renamed.
- Analytics writes must never fail the primary operation they're attached to (design doc "Error
  handling" section).
- `user_id` in analytics is the internal account id, **never** the email address (AC9, D-decision
  on minimal PII).
- No manuscript text, prompts, uploaded sources, reviewer comments, or payment details may enter
  an analytics event's `properties` payload (AC9) — enforced by a denylist validator at the
  schema boundary, not by convention.
- `asyncpg` for all DB access (backend rule #6) — no SQLAlchemy, no blocking calls.
- No live Anthropic/Redis/DB in CI without `DATABASE_URL` set — DB-backed tests use the existing
  `pytestmark = pytest.mark.skipif(not DSN, ...)` pattern (see `tests/test_feedback_router.py`).
- `structlog` for the one place we log (analytics-write failure at instrumented call sites) —
  never `print()`.

---

### Task 1: Migration `0030` — `analytics_event` and `journey_state` tables

**Files:**
- Create: `backend/alembic/versions/0030_analytics_event_and_journey_state.py`

**Interfaces:**
- Produces: tables `analytics_event`, `journey_state` that all later tasks read/write via raw
  SQL. Column set is fixed by this task — later tasks must not add columns without a new
  migration.

- [ ] **Step 1: Write the migration**

```python
"""analytics event log + journey-state (journey analytics sub-project 1)"""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE analytics_event (
            event_id            uuid PRIMARY KEY,
            event_name          text NOT NULL,
            occurred_at         timestamptz NOT NULL,
            anonymous_id        text,
            user_id             uuid REFERENCES account(id) ON DELETE SET NULL,
            session_id          text NOT NULL,
            project_id          text,
            journey_stage       text,
            use_case            text,
            content_type        text,
            plan_id             text,
            acquisition_source  text,
            device_class        text NOT NULL,
            experiment_variant  text,
            success             boolean,
            error_code          text,
            duration_ms         integer,
            properties          jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at          timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX analytics_event_user_id_occurred_at_idx "
        "ON analytics_event (user_id, occurred_at) WHERE user_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX analytics_event_anonymous_id_idx "
        "ON analytics_event (anonymous_id) WHERE anonymous_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX analytics_event_event_name_occurred_at_idx "
        "ON analytics_event (event_name, occurred_at)"
    )
    op.execute(
        """
        CREATE TABLE journey_state (
            user_id                   uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
            current_journey_stage     text NOT NULL DEFAULT 'discover_join',
            stage_status              text NOT NULL DEFAULT 'not_started',
            last_meaningful_event     text,
            last_meaningful_event_at  timestamptz,
            stall_reason              text,
            stalled_at                timestamptz,
            intervention_status       text,
            next_best_action          text,
            resumed_at                timestamptz,
            updated_at                timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE journey_state")
    op.execute("DROP TABLE analytics_event")
```

- [ ] **Step 2: Run the migration against the local test DB and verify**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test alembic -c alembic.ini upgrade head`
Expected: no errors; `alembic current` reports `0030`.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0030_analytics_event_and_journey_state.py
git commit -m "feat(analytics): add analytics_event + journey_state tables (migration 0030)"
```

---

### Task 2: Canonical enums + Pydantic event schema with privacy denylist

**Files:**
- Create: `backend/src/analytics/__init__.py` (empty)
- Create: `backend/src/analytics/models.py`
- Create: `backend/src/analytics/schemas.py`
- Test: `backend/tests/test_analytics_schemas.py`

**Interfaces:**
- Produces: `EventName` (StrEnum), `JourneyStage` (StrEnum), `StageStatus` (StrEnum),
  `DeviceClass` (StrEnum), `EventIn` (Pydantic model, the ingestion payload shape),
  `PrivacyViolation` (Exception, raised by `validate_no_sensitive_fields`).

- [ ] **Step 1: Write `models.py` — the canonical enums**

```python
"""Canonical event/stage enums — verbatim from the Journey Analytics Build Spec v1.2.
Do not rename these values; downstream sub-projects (stall detection, dashboards) key off them."""

from __future__ import annotations

from enum import StrEnum


class JourneyStage(StrEnum):
    DISCOVER_JOIN = "discover_join"
    CREATE_FIRST_VALUE = "create_first_value"
    REFINE_VALIDATE = "refine_validate"
    FINISH_PAY = "finish_pay"
    RETURN_ADVOCATE = "return_advocate"


class StageStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    STALLED = "stalled"
    COMPLETED = "completed"


class DeviceClass(StrEnum):
    DESKTOP = "desktop"
    TABLET = "tablet"
    MOBILE = "mobile"


class EventName(StrEnum):
    LANDING_VIEWED = "landing_viewed"
    SAMPLE_VIEWED = "sample_viewed"
    PRICING_VIEWED = "pricing_viewed"
    SIGNUP_STARTED = "signup_started"
    SIGNUP_COMPLETED = "signup_completed"
    PROJECT_CREATED = "project_created"
    BRIEF_COMPLETED = "brief_completed"
    GENERATION_STARTED = "generation_started"
    GENERATION_COMPLETED = "generation_completed"
    GENERATION_FAILED = "generation_failed"
    REGENERATION_REQUESTED = "regeneration_requested"
    MEANINGFUL_ACTION_COMPLETED = "meaningful_action_completed"
    SECTION_SAVED = "section_saved"
    RETURN_SESSION_STARTED = "return_session_started"
    VALIDATION_REQUESTED = "validation_requested"
    REVIEWER_INVITED = "reviewer_invited"
    REVIEW_COMPLETED = "review_completed"
    VALIDATION_ISSUE_RESOLVED = "validation_issue_resolved"
    PREVIEW_OPENED = "preview_opened"
    EXPORT_STARTED = "export_started"
    EXPORT_COMPLETED = "export_completed"
    EXPORT_FAILED = "export_failed"
    PUBLISH_COMPLETED = "publish_completed"
    PAYWALL_VIEWED = "paywall_viewed"
    CHECKOUT_STARTED = "checkout_started"
    CHECKOUT_COMPLETED = "checkout_completed"
    CHECKOUT_FAILED = "checkout_failed"
    SECOND_PROJECT_CREATED = "second_project_created"
    SUBSCRIPTION_CANCELLED = "subscription_cancelled"
    REFERRAL_SHARED = "referral_shared"
    REFERRAL_CONVERTED = "referral_converted"
    HELP_OPENED = "help_opened"
    INTERVENTION_SENT = "intervention_sent"
    JOURNEY_RESUMED = "journey_resumed"
    FOLLOWUP_DRAFT_CREATED = "followup_draft_created"
    FOLLOWUP_REVIEW_COMPLETED = "followup_review_completed"
    FOLLOWUP_EMAIL_SENT = "followup_email_sent"
    FOLLOWUP_EMAIL_DELIVERED = "followup_email_delivered"
    FOLLOWUP_EMAIL_FAILED = "followup_email_failed"
    FOLLOWUP_HELP_REQUESTED = "followup_help_requested"
    FOLLOWUP_FEEDBACK_SUBMITTED = "followup_feedback_submitted"


# Events sub-project 1 emits from the server (the Instrumentation Map in the design doc).
# All other EventName members have their schema defined but no emitter yet.
SERVER_CONFIRMED_EVENTS = frozenset(
    {
        EventName.SIGNUP_COMPLETED,
        EventName.GENERATION_COMPLETED,
        EventName.GENERATION_FAILED,
        EventName.MEANINGFUL_ACTION_COMPLETED,
        EventName.REVIEW_COMPLETED,
        EventName.EXPORT_COMPLETED,
        EventName.EXPORT_FAILED,
        EventName.CHECKOUT_COMPLETED,
        EventName.CHECKOUT_FAILED,
        EventName.SECOND_PROJECT_CREATED,
    }
)
```

- [ ] **Step 2: Write `schemas.py` — the Common Event Contract + privacy denylist**

```python
"""Common Event Contract (design doc §"Data model") and the privacy enforcement boundary
(AC9): no manuscript text, prompts, reviewer comments, emails, or payment details may enter
an event's `properties` payload."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_validator

from backend.src.analytics.models import DeviceClass, EventName, JourneyStage

# Key fragments that must never appear in `properties`. Substring match on the
# lower-cased key, not the value — a key like "reviewer_comment_id" is still refused,
# which is intentionally conservative (AC9 has no tolerance for false negatives here).
_FORBIDDEN_PROPERTY_KEY_FRAGMENTS = (
    "manuscript",
    "prompt",
    "source_text",
    "reviewer_comment",
    "email",
    "card_number",
    "payment_method",
    "cvv",
)

_EMAIL_SHAPED = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class PrivacyViolation(ValueError):
    """Raised when an event payload contains a field the analytics store must never hold."""


def validate_no_sensitive_fields(properties: dict) -> None:
    for key, value in properties.items():
        lowered = key.lower()
        for fragment in _FORBIDDEN_PROPERTY_KEY_FRAGMENTS:
            if fragment in lowered:
                raise PrivacyViolation(f"properties key '{key}' looks like sensitive data (matches '{fragment}')")
        if isinstance(value, str) and _EMAIL_SHAPED.search(value):
            raise PrivacyViolation(f"properties key '{key}' has an email-shaped value")


class EventIn(BaseModel):
    """The Common Event Contract, as posted by a client to `/api/v1/analytics/events`.
    Server-confirmed events skip this HTTP shape and call `record_event()` directly."""

    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    event_name: EventName
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    anonymous_id: str | None = None
    session_id: str
    project_id: str | None = None
    journey_stage: JourneyStage | None = None
    use_case: str | None = None
    content_type: str | None = None
    plan_id: str | None = None
    acquisition_source: str | None = None
    device_class: DeviceClass
    experiment_variant: str | None = None
    success: bool | None = None
    error_code: str | None = None
    duration_ms: int | None = None
    properties: dict = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def _no_sensitive_fields(cls, v: dict) -> dict:
        validate_no_sensitive_fields(v)
        return v
```

- [ ] **Step 3: Write the failing tests**

```python
import pytest

from backend.src.analytics.schemas import EventIn, PrivacyViolation, validate_no_sensitive_fields


def test_rejects_manuscript_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"manuscript_excerpt": "once upon a time"})


def test_rejects_prompt_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"prompt": "write a story about..."})


def test_rejects_reviewer_comment_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"reviewer_comment_text": "needs work"})


def test_rejects_email_shaped_value_regardless_of_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"note": "contact me at jane@example.com"})


def test_rejects_payment_method_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"payment_method": "visa"})


def test_allows_clean_properties():
    validate_no_sensitive_fields({"output_word_count": 512, "latency_ms": 4200})


def test_event_in_rejects_sensitive_properties_at_construction():
    with pytest.raises(ValueError):
        EventIn(
            event_name="sample_viewed",
            session_id="s-1",
            device_class="desktop",
            properties={"prompt": "leaked"},
        )


def test_event_in_accepts_clean_payload():
    ev = EventIn(
        event_name="sample_viewed",
        session_id="s-1",
        device_class="desktop",
        properties={"sample_id": "abc", "use_case": "book"},
    )
    assert ev.event_name == "sample_viewed"
    assert ev.event_id is not None
```

- [ ] **Step 4: Run tests to verify they fail (module doesn't exist yet)**

Run: `cd backend && pytest tests/test_analytics_schemas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.src.analytics'`

- [ ] **Step 5: Create the module files from steps 1–2 above, then run tests again**

Run: `cd backend && pytest tests/test_analytics_schemas.py -v`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add backend/src/analytics/__init__.py backend/src/analytics/models.py \
  backend/src/analytics/schemas.py backend/tests/test_analytics_schemas.py
git commit -m "feat(analytics): canonical event enums + Common Event Contract schema with privacy denylist"
```

---

### Task 3: `record_event`, `get_journey_state`, `merge_anonymous_into_user` (repo layer)

**Files:**
- Create: `backend/src/analytics/repo.py`
- Test: `backend/tests/test_analytics_repo.py`

**Interfaces:**
- Consumes: `EventIn` (Task 2), `analytics_event`/`journey_state` tables (Task 1).
- Produces: `record_event(conn, *, event: EventIn, user_id: uuid.UUID | None) -> None`,
  `get_journey_state(conn, user_id: uuid.UUID) -> asyncpg.Record | None`,
  `merge_anonymous_into_user(conn, *, anonymous_id: str, user_id: uuid.UUID) -> int` (returns
  rows updated). Task 4 (the evaluator) and Task 5 (the router) call these.

- [ ] **Step 1: Write the failing tests**

```python
import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

from backend.src.analytics import repo
from backend.src.analytics.schemas import EventIn

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


@pytest_asyncio.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    try:
        yield c
    finally:
        await c.execute("DELETE FROM analytics_event")
        await c.execute("DELETE FROM journey_state")
        await c.close()


@pytest_asyncio.fixture
async def account_id(conn):
    row = await conn.fetchrow(
        "INSERT INTO account (idp_sub, email) VALUES ($1, $2) RETURNING id",
        f"sub-{uuid.uuid4()}",
        "test@example.com",
    )
    yield row["id"]
    await conn.execute("DELETE FROM account WHERE id = $1", row["id"])


@pytest.mark.asyncio
async def test_record_event_inserts_row(conn, account_id):
    ev = EventIn(event_name="signup_completed", session_id="s-1", device_class="desktop")
    await repo.record_event(conn, event=ev, user_id=account_id)
    row = await conn.fetchrow("SELECT * FROM analytics_event WHERE event_id = $1", ev.event_id)
    assert row is not None
    assert row["event_name"] == "signup_completed"
    assert row["user_id"] == account_id


@pytest.mark.asyncio
async def test_record_event_allows_null_user_id_for_anonymous(conn):
    ev = EventIn(
        event_name="sample_viewed",
        session_id="s-2",
        anonymous_id="anon-1",
        device_class="mobile",
    )
    await repo.record_event(conn, event=ev, user_id=None)
    row = await conn.fetchrow("SELECT * FROM analytics_event WHERE event_id = $1", ev.event_id)
    assert row["user_id"] is None
    assert row["anonymous_id"] == "anon-1"


@pytest.mark.asyncio
async def test_get_journey_state_returns_none_when_absent(conn, account_id):
    assert await repo.get_journey_state(conn, account_id) is None


@pytest.mark.asyncio
async def test_merge_anonymous_into_user_backfills_user_id(conn, account_id):
    ev = EventIn(
        event_name="sample_viewed",
        session_id="s-3",
        anonymous_id="anon-merge-me",
        device_class="desktop",
    )
    await repo.record_event(conn, event=ev, user_id=None)
    updated = await repo.merge_anonymous_into_user(
        conn, anonymous_id="anon-merge-me", user_id=account_id
    )
    assert updated == 1
    row = await conn.fetchrow("SELECT user_id FROM analytics_event WHERE event_id = $1", ev.event_id)
    assert row["user_id"] == account_id


@pytest.mark.asyncio
async def test_merge_anonymous_into_user_is_idempotent(conn, account_id):
    updated = await repo.merge_anonymous_into_user(
        conn, anonymous_id="anon-never-seen", user_id=account_id
    )
    assert updated == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/test_analytics_repo.py -v`
Expected: FAIL — `ModuleNotFoundError` or `AttributeError: module 'repo' has no attribute 'record_event'`

- [ ] **Step 3: Write `repo.py`**

```python
"""Analytics repo layer — the sole write path for events and journey state.
asyncpg raw SQL, matching the codebase's existing pattern (backend/src/feedback/repo.py)."""

from __future__ import annotations

import json
import uuid

import asyncpg

from backend.src.analytics.schemas import EventIn


async def record_event(
    conn: asyncpg.Connection, *, event: EventIn, user_id: uuid.UUID | None
) -> None:
    """Insert one analytics_event row. Caller is responsible for calling
    evaluate-and-persist journey state afterward if this event should update it —
    this function only appends to the log."""
    await conn.execute(
        """
        INSERT INTO analytics_event (
            event_id, event_name, occurred_at, anonymous_id, user_id, session_id,
            project_id, journey_stage, use_case, content_type, plan_id,
            acquisition_source, device_class, experiment_variant, success,
            error_code, duration_ms, properties
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
        """,
        event.event_id,
        event.event_name.value,
        event.occurred_at,
        event.anonymous_id,
        user_id,
        event.session_id,
        event.project_id,
        event.journey_stage.value if event.journey_stage else None,
        event.use_case,
        event.content_type,
        event.plan_id,
        event.acquisition_source,
        event.device_class.value,
        event.experiment_variant,
        event.success,
        event.error_code,
        event.duration_ms,
        json.dumps(event.properties),
    )


async def get_journey_state(conn: asyncpg.Connection, user_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow("SELECT * FROM journey_state WHERE user_id = $1", user_id)


async def upsert_journey_state(
    conn: asyncpg.Connection,
    *,
    user_id: uuid.UUID,
    current_journey_stage: str,
    stage_status: str,
    last_meaningful_event: str | None,
    last_meaningful_event_at,
) -> None:
    await conn.execute(
        """
        INSERT INTO journey_state (
            user_id, current_journey_stage, stage_status,
            last_meaningful_event, last_meaningful_event_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id) DO UPDATE SET
            current_journey_stage = EXCLUDED.current_journey_stage,
            stage_status = EXCLUDED.stage_status,
            last_meaningful_event = EXCLUDED.last_meaningful_event,
            last_meaningful_event_at = EXCLUDED.last_meaningful_event_at,
            updated_at = now()
        """,
        user_id,
        current_journey_stage,
        stage_status,
        last_meaningful_event,
        last_meaningful_event_at,
    )


async def get_events_for_user(conn: asyncpg.Connection, user_id: uuid.UUID) -> list[asyncpg.Record]:
    """Full event history for one user, oldest first — the input to evaluate_journey_state."""
    return await conn.fetch(
        "SELECT * FROM analytics_event WHERE user_id = $1 ORDER BY occurred_at ASC", user_id
    )


async def merge_anonymous_into_user(
    conn: asyncpg.Connection, *, anonymous_id: str, user_id: uuid.UUID
) -> int:
    """Backfill user_id onto every anonymous_id-tagged event at signup. Returns rows updated.
    Idempotent — re-running against an already-merged anonymous_id updates 0 rows."""
    result = await conn.execute(
        "UPDATE analytics_event SET user_id = $1 WHERE anonymous_id = $2 AND user_id IS NULL",
        user_id,
        anonymous_id,
    )
    # asyncpg execute() returns a string like "UPDATE 3"
    return int(result.split()[-1])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/test_analytics_repo.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/analytics/repo.py backend/tests/test_analytics_repo.py
git commit -m "feat(analytics): repo layer — record_event, journey_state upsert, anonymous merge"
```

---

### Task 4: `evaluate_journey_state` — the pure journey-state evaluator

**Files:**
- Create: `backend/src/analytics/journey.py`
- Test: `backend/tests/test_analytics_journey.py`

**Interfaces:**
- Consumes: rows shaped like `analytics_event` (as dicts, so this stays DB-free and unit-testable
  — `get_events_for_user()` rows from Task 3 satisfy this shape via `dict(record)`).
- Produces: `evaluate_journey_state(events: list[dict]) -> JourneyStateResult` (a dataclass with
  `current_journey_stage: JourneyStage`, `stage_status: StageStatus`,
  `last_meaningful_event: str | None`, `last_meaningful_event_at: datetime | None`). Task 6
  (signup instrumentation) and the follow-up plan's remaining instrumentation tasks call this
  after every `record_event()` to recompute and then `upsert_journey_state()`.

- [ ] **Step 1: Write the failing tests**

```python
from datetime import UTC, datetime

from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.models import JourneyStage, StageStatus

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _event(name, **props):
    return {"event_name": name, "occurred_at": T0, "properties": props}


def test_no_events_is_not_started_at_discover_join():
    result = evaluate_journey_state([])
    assert result.current_journey_stage == JourneyStage.DISCOVER_JOIN
    assert result.stage_status == StageStatus.NOT_STARTED


def test_signup_completed_advances_to_create_first_value_in_progress():
    result = evaluate_journey_state([_event("signup_completed")])
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE
    assert result.stage_status == StageStatus.IN_PROGRESS


def test_generation_completed_alone_does_not_activate_user():
    """AC3 / the doc's Primary Activation Decision: draft generation without a
    meaningful follow-up action is NOT activation."""
    result = evaluate_journey_state(
        [_event("signup_completed"), _event("generation_completed")]
    )
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE
    assert result.stage_status == StageStatus.IN_PROGRESS
    assert result.last_meaningful_event != "generation_completed"


def test_meaningful_action_completed_with_edit_advances_to_refine_validate():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("generation_completed"),
            _event("meaningful_action_completed", action_type="edit"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.REFINE_VALIDATE
    assert result.stage_status == StageStatus.IN_PROGRESS
    assert result.last_meaningful_event == "meaningful_action_completed"


def test_meaningful_action_completed_requires_qualifying_action_type():
    """Opening/scrolling a draft does not qualify (Meaningful Action Rules)."""
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="view"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE


def test_review_completed_advances_to_finish_pay():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="save"),
            _event("review_completed"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.FINISH_PAY


def test_export_completed_advances_to_return_advocate_completed():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="approve"),
            _event("review_completed"),
            _event("export_completed"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.RETURN_ADVOCATE
    assert result.stage_status == StageStatus.IN_PROGRESS


def test_second_project_created_marks_return_advocate_completed():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="continue"),
            _event("export_completed"),
            _event("second_project_created"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.RETURN_ADVOCATE
    assert result.stage_status == StageStatus.COMPLETED


def test_last_meaningful_event_tracks_most_recent_progress_event():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="save"),
        ]
    )
    assert result.last_meaningful_event == "meaningful_action_completed"
    assert result.last_meaningful_event_at == T0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_analytics_journey.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.src.analytics.journey'`

- [ ] **Step 3: Write `journey.py`**

```python
"""Pure journey-state evaluator. No DB dependency — rebuildable from full event history
(AC2/AC4). Stage-advancement rules come from the design doc's Journey Stage Requirements
table and the Primary Activation Decision (generation alone never activates)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from backend.src.analytics.models import JourneyStage, StageStatus

_QUALIFYING_ACTION_TYPES = {"edit", "save", "approve", "continue"}

# Events that count as "meaningful progress" for last_meaningful_event, in the
# order that advances current_journey_stage. Each entry's presence in history
# (with any extra per-event condition satisfied) unlocks the next stage.
_STAGE_ORDER = [
    JourneyStage.DISCOVER_JOIN,
    JourneyStage.CREATE_FIRST_VALUE,
    JourneyStage.REFINE_VALIDATE,
    JourneyStage.FINISH_PAY,
    JourneyStage.RETURN_ADVOCATE,
]


@dataclass(frozen=True)
class JourneyStateResult:
    current_journey_stage: JourneyStage
    stage_status: StageStatus
    last_meaningful_event: str | None
    last_meaningful_event_at: datetime | None


def _is_meaningful_action(event: dict) -> bool:
    if event["event_name"] != "meaningful_action_completed":
        return False
    return event.get("properties", {}).get("action_type") in _QUALIFYING_ACTION_TYPES


def evaluate_journey_state(events: list[dict]) -> JourneyStateResult:
    stage_index = 0  # discover_join
    status = StageStatus.NOT_STARTED
    last_meaningful_event: str | None = None
    last_meaningful_event_at: datetime | None = None

    for event in events:
        name = event["event_name"]

        if name == "signup_completed" and stage_index == 0:
            stage_index = 1  # create_first_value
            status = StageStatus.IN_PROGRESS
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

        elif _is_meaningful_action(event) and stage_index == 1:
            stage_index = 2  # refine_validate
            status = StageStatus.IN_PROGRESS
            last_meaningful_event = "meaningful_action_completed"
            last_meaningful_event_at = event["occurred_at"]

        elif name == "review_completed" and stage_index == 2:
            stage_index = 3  # finish_pay
            status = StageStatus.IN_PROGRESS
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

        elif name in ("export_completed", "publish_completed") and stage_index == 3:
            stage_index = 4  # return_advocate
            status = StageStatus.IN_PROGRESS
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

        elif name == "second_project_created" and stage_index == 4:
            status = StageStatus.COMPLETED
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

    return JourneyStateResult(
        current_journey_stage=_STAGE_ORDER[stage_index],
        stage_status=status,
        last_meaningful_event=last_meaningful_event,
        last_meaningful_event_at=last_meaningful_event_at,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_analytics_journey.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/analytics/journey.py backend/tests/test_analytics_journey.py
git commit -m "feat(analytics): pure journey-state evaluator with stage-advancement rules"
```

---

### Task 5: `POST /api/v1/analytics/events` ingestion endpoint

**Files:**
- Create: `backend/src/analytics/router.py`
- Modify: `backend/main.py` (register the router — find the existing `app.include_router(...)`
  block and add one line following the same pattern as the other routers there)
- Test: `backend/tests/test_analytics_router.py`

**Interfaces:**
- Consumes: `EventIn` (Task 2), `record_event`/`upsert_journey_state`/`get_events_for_user`
  (Task 3), `evaluate_journey_state` (Task 4), `require_active_user` (existing,
  `backend/src/accounts/deps.py`).
- Produces: `router` (FastAPI `APIRouter`), importable as
  `backend.src.analytics.router.router`.

- [ ] **Step 1: Write the failing test**

```python
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def _as(sub, email):
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


def test_post_event_accepts_valid_payload():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z")
        r = c.post(
            "/api/v1/analytics/events",
            json={
                "event_name": "sample_viewed",
                "session_id": "s-1",
                "device_class": "desktop",
                "properties": {"sample_id": "abc"},
            },
        )
        assert r.status_code == 201, r.text
    app.dependency_overrides.clear()


def test_post_event_rejects_sensitive_properties():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z")
        r = c.post(
            "/api/v1/analytics/events",
            json={
                "event_name": "sample_viewed",
                "session_id": "s-1",
                "device_class": "desktop",
                "properties": {"prompt": "leaked text"},
            },
        )
        assert r.status_code == 422
    app.dependency_overrides.clear()


def test_post_event_recomputes_journey_state():
    with TestClient(app) as c:
        sub, email = f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z"
        _as(sub, email)
        r = c.post(
            "/api/v1/analytics/events",
            json={
                "event_name": "signup_completed",
                "session_id": "s-2",
                "device_class": "desktop",
            },
        )
        assert r.status_code == 201, r.text
    app.dependency_overrides.clear()

    import asyncpg

    async def _check():
        conn = await asyncpg.connect(DSN)
        try:
            acct = await conn.fetchrow("SELECT id FROM account WHERE idp_sub = $1", sub)
            state = await conn.fetchrow(
                "SELECT * FROM journey_state WHERE user_id = $1", acct["id"]
            )
            assert state is not None
            assert state["current_journey_stage"] == "create_first_value"
        finally:
            await conn.close()

    import anyio

    anyio.run(_check)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/test_analytics_router.py -v`
Expected: FAIL — 404 (router not registered) or `ModuleNotFoundError`

- [ ] **Step 3: Write `router.py`**

```python
"""Batched analytics ingestion for client-originated events. Server-confirmed events
(signup, generation, export, checkout, review) call record_event() directly, in-process —
see the design doc's Instrumentation Map. This endpoint is for everything else."""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, status

from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.analytics import repo
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.schemas import EventIn
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


@router.post("/events", status_code=status.HTTP_201_CREATED)
async def post_event(
    body: EventIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> dict:
    account = await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )
    await repo.record_event(conn, event=body, user_id=account.id)

    history = await repo.get_events_for_user(conn, account.id)
    result = evaluate_journey_state([dict(row) for row in history])
    await repo.upsert_journey_state(
        conn,
        user_id=account.id,
        current_journey_stage=result.current_journey_stage.value,
        stage_status=result.stage_status.value,
        last_meaningful_event=result.last_meaningful_event,
        last_meaningful_event_at=result.last_meaningful_event_at,
    )
    return {"event_id": str(body.event_id)}
```

- [ ] **Step 4: Register the router in `backend/main.py`**

Find the block of `app.include_router(...)` calls in `backend/main.py` (each existing domain
router — feedback, trust, billing, etc. — is registered there) and add, following the same
import-and-register pattern already used for every other router in that file:

```python
from backend.src.analytics.router import router as analytics_router
```

and

```python
app.include_router(analytics_router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/test_analytics_router.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add backend/src/analytics/router.py backend/main.py backend/tests/test_analytics_router.py
git commit -m "feat(analytics): POST /api/v1/analytics/events ingestion endpoint"
```

---

### Task 6: Wire `signup_completed` — the reference instrumentation site

**Files:**
- Modify: `backend/src/accounts/deps.py` (the `require_active_user` dependency)
- Test: `backend/tests/test_analytics_signup_instrumentation.py`

**Interfaces:**
- Consumes: `accounts_repo.get_account`/`get_or_create_account` (existing),
  `repo.record_event`/`get_events_for_user`/`upsert_journey_state` (Task 3),
  `evaluate_journey_state` (Task 4), `EventIn` (Task 2).
- Produces: the behavioral change — first-ever authenticated request for a given `idp_sub` now
  both creates the account row (as before) AND emits `signup_completed` + recomputes journey
  state. This is the pattern the follow-up plan's remaining 6 instrumentation tasks copy.

- [ ] **Step 1: Write the failing test**

```python
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def test_first_authenticated_request_emits_signup_completed_and_advances_journey_state():
    sub, email = f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z"
    app.dependency_overrides[require_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )
    with TestClient(app) as c:
        # Any authenticated route that depends on require_active_user triggers the
        # dependency's first-touch check — /api/v1/account is the simplest existing one.
        r = c.get("/api/v1/account")
        assert r.status_code == 200, r.text
    app.dependency_overrides.clear()

    import anyio
    import asyncpg

    async def _check():
        conn = await asyncpg.connect(DSN)
        try:
            acct = await conn.fetchrow("SELECT id FROM account WHERE idp_sub = $1", sub)
            assert acct is not None
            ev = await conn.fetchrow(
                "SELECT * FROM analytics_event WHERE user_id = $1 AND event_name = $2",
                acct["id"],
                "signup_completed",
            )
            assert ev is not None
            state = await conn.fetchrow(
                "SELECT * FROM journey_state WHERE user_id = $1", acct["id"]
            )
            assert state["current_journey_stage"] == "create_first_value"
        finally:
            await conn.close()

    anyio.run(_check)


def test_second_authenticated_request_does_not_emit_signup_completed_again():
    sub, email = f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z"
    app.dependency_overrides[require_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )
    with TestClient(app) as c:
        c.get("/api/v1/account")
        c.get("/api/v1/account")
    app.dependency_overrides.clear()

    import anyio
    import asyncpg

    async def _check():
        conn = await asyncpg.connect(DSN)
        try:
            acct = await conn.fetchrow("SELECT id FROM account WHERE idp_sub = $1", sub)
            rows = await conn.fetch(
                "SELECT * FROM analytics_event WHERE user_id = $1 AND event_name = $2",
                acct["id"],
                "signup_completed",
            )
            assert len(rows) == 1
        finally:
            await conn.close()

    anyio.run(_check)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/test_analytics_signup_instrumentation.py -v`
Expected: FAIL — no `signup_completed` row exists yet

- [ ] **Step 3: Modify `backend/src/accounts/deps.py`**

The current `require_active_user` looks up the account only to check suspension, and is a
pass-through when the account doesn't exist yet (account creation happens lazily at whichever
route calls `get_or_create_account`). Change it so the *dependency itself* detects the
account-doesn't-exist case (the true first touch) and both creates the account and records
`signup_completed`, instead of leaving that ambiguous across a dozen call sites:

```python
from __future__ import annotations

import uuid

import asyncpg
from fastapi import Depends, HTTPException, Request, status

from backend.src.accounts import repo
from backend.src.analytics import repo as analytics_repo
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.schemas import EventIn
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


async def require_active_user(
    request: Request, principal: Principal = Depends(require_user)
) -> Principal:
    """Verified caller who is not suspended; else 403. Pass-through when no DB.
    Also the signup_completed instrumentation point: the first authenticated request for
    a given idp_sub is, by definition, the moment the account durably exists."""
    pool: asyncpg.Pool | None = getattr(request.app.state, "db", None)
    if pool is None:
        return principal  # no account store → no suspension state
    async with pool.acquire() as conn:
        account = await repo.get_account(conn, idp_sub=principal.sub)
        if account is None:
            account = await repo.get_or_create_account(
                conn, idp_sub=principal.sub, email=principal.email
            )
            await _record_signup_completed(conn, user_id=account.id)
    if account is not None and account.suspended:
        # Body names no identity (key/identity discipline).
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account suspended")
    return principal


async def _record_signup_completed(conn: asyncpg.Connection, *, user_id: uuid.UUID) -> None:
    """Analytics writes must never fail the primary operation (design doc, Error handling)."""
    try:
        event = EventIn(
            event_name="signup_completed",
            session_id=str(uuid.uuid4()),
            device_class="desktop",
        )
        await analytics_repo.record_event(conn, event=event, user_id=user_id)
        history = await analytics_repo.get_events_for_user(conn, user_id)
        result = evaluate_journey_state([dict(row) for row in history])
        await analytics_repo.upsert_journey_state(
            conn,
            user_id=user_id,
            current_journey_stage=result.current_journey_stage.value,
            stage_status=result.stage_status.value,
            last_meaningful_event=result.last_meaningful_event,
            last_meaningful_event_at=result.last_meaningful_event_at,
        )
    except Exception:
        import structlog

        structlog.get_logger(__name__).warning(
            "analytics_signup_event_failed", user_id=str(user_id)
        )
```

Note: `device_class` and `session_id` are not knowable server-side at this point (no request
body carries them for an implicit first-touch event) — `device_class` defaults to `"desktop"`
and `session_id` is a fresh UUID. This is a known approximation specific to the
`signup_completed` server-confirmed path; flagged here rather than silently assumed, since the
Common Event Contract normally expects these from the client. Acceptable for sub-project 1
because journey-stage advancement doesn't depend on either field's value.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/test_analytics_signup_instrumentation.py -v`
Expected: 2 passed

- [ ] **Step 5: Run the full existing accounts test suite to check for regressions**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest tests/ -k account -v`
Expected: all passing (no test asserts the old "lazy creation, no signup event" behavior in a
way that would now fail — if one does, update it to expect the new `analytics_event` row rather
than removing the assertion).

- [ ] **Step 6: Commit**

```bash
git add backend/src/accounts/deps.py backend/tests/test_analytics_signup_instrumentation.py
git commit -m "feat(analytics): wire signup_completed into require_active_user (first-touch account creation)"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete backend test suite**

Run: `cd backend && DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest -v`
Expected: all passing, including every test from Tasks 1–6 and no regressions elsewhere.

- [ ] **Step 2: Run ruff (both check and format — CI runs both, see feedback_ruff_format_gate)**

Run: `cd backend && ruff check . && ruff format --check .`
Expected: no errors.

- [ ] **Step 3: Confirm no placeholder/TBD content shipped**

Run: `grep -rn "TODO\|TBD\|FIXME" backend/src/analytics/`
Expected: no output.

---

## Follow-up (not in this plan)

The design doc's Instrumentation Map lists 6 more server-confirmed call sites
(`generation_completed`/`generation_failed`, `meaningful_action_completed`, `review_completed`,
`export_completed`/`export_failed`, `checkout_completed`/`checkout_failed`,
`second_project_created`). Each follows the exact pattern established in Task 6: wrap the
existing endpoint's success path in a try/except that calls `record_event()` +
`evaluate_journey_state()` + `upsert_journey_state()`, logs-and-swallows on failure, never
blocks the primary operation. That's a short, mechanical follow-up plan once this one is merged
— sequenced separately so each can be reviewed and tested independently per file, per the
brainstorming skill's decomposition guidance.

Also out of scope here, per the original design doc: stall detection (sub-project 2), the
human-approved email pipeline (sub-project 3), and dashboards (sub-project 4).
