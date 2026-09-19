# Journey Analytics Sub-Project 3 — Intervention Email Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-09-19-journey-analytics-sub-project-3-intervention-email-pipeline.md`

**Goal:** Build email intervention pipeline that sends personalized emails to stalled users and tracks response data (sent-at, customer response type, re-engagement rate) for Sub-Project 4 dashboards.

**Acceptance Criteria:**
- ✅ Migration 0032 adds intervention tracking columns to journey_state
- ✅ InterventionService sends templated emails by stall_reason via ZeptoMail
- ✅ Response detection: meaningful_action after intervention_sent_at → customer_response_type = resumed_journey
- ✅ Manual super-admin endpoint for MVP trigger (no scheduler yet)
- ✅ Tests pass; Sub-Project 4 can query re-engagement metrics

---

## Task 1: Migration 0032 + Schema Updates

**Files:**
- Create: `backend/alembic/versions/0032_intervention_response_tracking.py`
- Amend: `backend/src/analytics/models.py`

**Interfaces:**
- Adds `intervention_sent_at`, `customer_response_type`, `intervention_attempt_count` to journey_state table
- New `CustomerResponseType` enum in models.py

**Steps:**

- [ ] **Step 1.1: Create migration 0032**

```python
"""intervention response tracking — journey analytics sub-project 3"""

from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "journey_state",
        sa.Column("intervention_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "journey_state",
        sa.Column("customer_response_type", sa.Text, nullable=True),
    )
    op.add_column(
        "journey_state",
        sa.Column("intervention_attempt_count", sa.Integer, server_default="0", nullable=False),
    )
    op.create_index(
        "journey_state_intervention_status_sent_at_idx",
        "journey_state",
        ["intervention_status", "intervention_sent_at"],
        where=op.text("intervention_status = 'not_started'"),
    )


def downgrade() -> None:
    op.drop_index("journey_state_intervention_status_sent_at_idx")
    op.drop_column("journey_state", "intervention_attempt_count")
    op.drop_column("journey_state", "customer_response_type")
    op.drop_column("journey_state", "intervention_sent_at")
```

- [ ] **Step 1.2: Add `CustomerResponseType` enum to models.py**

```python
class CustomerResponseType(StrEnum):
    """Customer response to intervention (sub-project 3)."""
    RESUMED_JOURNEY = "resumed_journey"
    UNSUBSCRIBED = "unsubscribed"
    NO_RESPONSE = "no_response"
    UNKNOWN = "unknown"
```

- [ ] **Step 1.3: Test migration applies without error**

```bash
cd backend && alembic upgrade head
```

---

## Task 2: InterventionService + Email Templates

**Files:**
- Create: `backend/src/analytics/intervention.py`
- Amend: `backend/config.py` (already has zeptomail_token)

**Interfaces:**
- `InterventionService.send_intervention_for_user()` — main entry point
- `STALL_REASON_TEMPLATES` — map stall_reason → email template
- Calls `record_event()` to emit `followup_email_sent` event

**Steps:**

- [ ] **Step 2.1: Create intervention.py with template map**

```python
from backend.src.analytics.models import StallReason, CustomerResponseType, EventName
from backend.config import settings
import httpx

STALL_REASON_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: {
        "subject": "Your content is ready—let's publish it 🚀",
        "body": """Hi {first_name},

We noticed you've drafted some great content but haven't published yet. 
Save and approve your work to activate it and start sharing with your audience.

👉 [Resume in Mentible]({app_url})

Your draft is waiting for you!

Best,
The Mentible Team""",
    },
    StallReason.INVITE_UNRESPONDED: {
        "subject": "Your expert reviewers are waiting",
        "body": """Hi {first_name},

You've invited expert reviewers to validate your content, 
but we haven't heard back from them yet. 

You can:
- Check in with your reviewers
- Add additional reviewers
- Proceed without validation

👉 [Check your project]({app_url})

Best,
The Mentible Team""",
    },
    StallReason.PAYMENT_INCOMPLETE: {
        "subject": "Finish checkout to publish",
        "body": """Hi {first_name},

You're one step away from publishing! 
Complete your payment to unlock unlimited publishing.

👉 [Complete checkout]({app_url})

Questions? We're here to help.

Best,
The Mentible Team""",
    },
    StallReason.INACTIVE: {
        "subject": "Welcome back! Let's finish your project",
        "body": """Hi {first_name},

We haven't seen you in a while. 
Your project is waiting for you—pick up where you left off.

👉 [Open Mentible]({app_url})

We're here to help if you need anything.

Best,
The Mentible Team""",
    },
    StallReason.UNKNOWN: {
        "subject": "We noticed you've paused",
        "body": """Hi {first_name},

We noticed you've paused your project. 
Is there anything blocking you? We're here to help.

👉 [Open Mentible]({app_url})

Just reply to this email or reach out to support@kaundinyalabs.com.

Best,
The Mentible Team""",
    },
}


class InterventionService:
    """Send intervention emails to stalled users; track response data."""

    @staticmethod
    async def send_intervention_for_user(
        conn,
        user_id: UUID,
        email: str,
        stall_reason: StallReason,
        journey_state_id: UUID,
        app_url: str = "https://mentible.app/",
    ) -> bool:
        """Send intervention email to one stalled user.
        
        Args:
            conn: asyncpg connection for event emission + journey_state update
            user_id: Account ID
            email: Email address to send to
            stall_reason: Which template to use
            journey_state_id: journey_state row for upsert
            app_url: Deep link URL for resume button
        
        Returns:
            True if email sent successfully, False otherwise
        
        Side effects:
            - Emits 'followup_email_sent' event
            - Updates journey_state: intervention_sent_at = now, intervention_status = in_progress
        """
        # 1. Select template
        template = STALL_REASON_TEMPLATES.get(stall_reason)
        if not template:
            template = STALL_REASON_TEMPLATES[StallReason.UNKNOWN]
        
        # 2. Render email (basic string interpolation; no Jinja2 yet)
        subject = template["subject"]
        body = template["body"].format(first_name="User", app_url=app_url)
        
        # 3. Send via ZeptoMail
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{settings.zeptomail_base_url}/email",
                    headers={
                        "Authorization": settings.zeptomail_token,
                    },
                    json={
                        "from": {"address": settings.zeptomail_from, "name": "Mentible"},
                        "to": [{"email_address": {"address": email}}],
                        "subject": subject,
                        "htmlbody": body,  # TODO: convert markdown → HTML
                        "reply_to": {"address": settings.feedback_to},
                    },
                )
                send_success = resp.status_code == 200
        except Exception as e:
            logger.warning(f"ZeptoMail send failed for user {user_id}: {e}")
            send_success = False
        
        # 4. Emit event (always, even on send failure)
        if send_success:
            await record_event(
                conn,
                event=EventIn(
                    event_name=EventName.FOLLOWUP_EMAIL_SENT,
                    occurred_at=datetime.now(UTC),
                    session_id="backend-intervention",
                    device_class=DeviceClass.DESKTOP,
                    properties={
                        "stall_reason": stall_reason.value,
                        "recipient_email": email,
                    },
                ),
                user_id=user_id,
            )
        else:
            await record_event(
                conn,
                event=EventIn(
                    event_name=EventName.FOLLOWUP_EMAIL_FAILED,
                    occurred_at=datetime.now(UTC),
                    session_id="backend-intervention",
                    device_class=DeviceClass.DESKTOP,
                    properties={
                        "stall_reason": stall_reason.value,
                        "recipient_email": email,
                    },
                ),
                user_id=user_id,
            )
        
        # 5. Update journey_state
        if send_success:
            await upsert_journey_state(
                conn,
                user_id=user_id,
                current_journey_stage=journey_state.current_journey_stage,
                stage_status=journey_state.stage_status,
                last_meaningful_event=journey_state.last_meaningful_event,
                last_meaningful_event_at=journey_state.last_meaningful_event_at,
                intervention_sent_at=datetime.now(UTC),
                intervention_status="in_progress",
            )
        
        return send_success
```

- [ ] **Step 2.2: Write template selection tests**

`backend/tests/test_intervention_templates.py`:
```python
def test_template_for_each_stall_reason():
    """Every StallReason has a template."""
    for reason in StallReason:
        assert reason in STALL_REASON_TEMPLATES or reason == StallReason.UNKNOWN

def test_template_has_required_fields():
    """Each template has subject and body."""
    for reason, template in STALL_REASON_TEMPLATES.items():
        assert "subject" in template
        assert "body" in template
        assert len(template["subject"]) > 0
        assert len(template["body"]) > 0
```

---

## Task 3: Response Detection (Resume Logic)

**Files:**
- Amend: `backend/src/analytics/journey.py`
- Amend: `backend/src/analytics/repo.py`

**Interfaces:**
- Journey evaluator detects meaningful_action after intervention_sent_at
- Sets `customer_response_type = resumed_journey`, `intervention_status = completed`

**Steps:**

- [ ] **Step 3.1: Amend journey.py to detect resume**

After existing stage-advancement logic, add:

```python
# Detect customer response to intervention (sub-project 3)
customer_response_type = None
if journey_state.intervention_sent_at is not None:
    # Check if user took meaningful action after intervention
    meaningful_actions_after = [
        e for e in events
        if e["event_name"] == "meaningful_action_completed"
        and e["occurred_at"] > journey_state.intervention_sent_at
    ]
    if meaningful_actions_after:
        customer_response_type = CustomerResponseType.RESUMED_JOURNEY
```

- [ ] **Step 3.2: Amend upsert_journey_state to write response type**

```python
async def upsert_journey_state(
    conn,
    *,
    # ... existing params ...
    customer_response_type: str | None = None,
):
    # ... upsert with additional fields
```

- [ ] **Step 3.3: Write integration test for resume detection**

```python
def test_resume_after_intervention_sets_customer_response_type():
    """Meaningful action after intervention_sent_at → resumed_journey."""
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
        # ... stall detected ...
        # intervention_sent_at = T0 + timedelta(days=8)
        _event("meaningful_action_completed", T0 + timedelta(days=9), action_type="edit"),
    ]
    # With intervention_sent_at set, second meaningful_action should trigger resumed_journey
```

---

## Task 4: Manual Super-Admin Endpoint

**Files:**
- Create: `backend/src/analytics/router.py` (or amend existing)

**Interfaces:**
- `POST /api/v1/analytics/interventions/send-stalled`
- Input: optional `user_id` to send to one user, or send to all not_started
- Gated on `require_super_admin()`

**Steps:**

- [ ] **Step 4.1: Add endpoint to router.py**

```python
@router.post("/interventions/send-stalled")
async def send_interventions(
    request: SendInterventionsRequest,  # user_id optional, dry_run bool
    conn: asyncpg.Connection = Depends(get_db),
    principal: Principal = Depends(require_super_admin),
) -> dict:
    """Send interventions to stalled users (manual trigger, super-admin only).
    
    Request:
        user_id (optional): Send to one user only. If omitted, send to all with intervention_status=not_started
        dry_run (bool): If true, don't actually send; just return count
    """
    service = InterventionService()
    
    if request.user_id:
        # Send to one user
        journey = await get_journey_state(conn, request.user_id)
        account = await get_account(conn, request.user_id)
        if not journey or not account or journey.intervention_status != "not_started":
            raise HTTPException(400, "User not stalled or already has intervention pending")
        
        sent = await service.send_intervention_for_user(
            conn, request.user_id, account.email, journey.stall_reason, journey.id
        )
        return {"sent_count": 1 if sent else 0, "user_id": str(request.user_id)}
    else:
        # Send to all intervention_status=not_started
        stalled_users = await conn.fetch(
            """SELECT user_id, stall_reason FROM journey_state 
               WHERE intervention_status = 'not_started' AND stalled_at IS NOT NULL"""
        )
        sent_count = 0
        for row in stalled_users:
            account = await get_account(conn, row["user_id"])
            if account and account.email:
                if not request.dry_run:
                    sent = await service.send_intervention_for_user(
                        conn, row["user_id"], account.email, row["stall_reason"], row["id"]
                    )
                    if sent:
                        sent_count += 1
        
        return {"sent_count": sent_count, "dry_run": request.dry_run}
```

- [ ] **Step 4.2: Add request schema**

```python
class SendInterventionsRequest(BaseModel):
    user_id: UUID | None = None
    dry_run: bool = False
```

- [ ] **Step 4.3: Test endpoint authorization**

```python
def test_send_interventions_requires_super_admin():
    """Endpoint is gated on require_super_admin."""
    # Non-admin should get 403
```

---

## Task 5: Repo Amendment (upsert_journey_state)

**Files:**
- Amend: `backend/src/analytics/repo.py`

**Steps:**

- [ ] **Step 5.1: Add intervention fields to upsert_journey_state**

```python
async def upsert_journey_state(
    conn,
    *,
    # ... existing params ...
    intervention_sent_at=None,
    customer_response_type: str | None = None,
    intervention_status: str | None = None,
    intervention_attempt_count: int | None = None,
):
    await conn.execute(
        """
        INSERT INTO journey_state (...)
        VALUES (...)
        ON CONFLICT (user_id) DO UPDATE SET
            intervention_sent_at = COALESCE(EXCLUDED.intervention_sent_at, journey_state.intervention_sent_at),
            customer_response_type = COALESCE(EXCLUDED.customer_response_type, journey_state.customer_response_type),
            intervention_status = EXCLUDED.intervention_status,
            intervention_attempt_count = COALESCE(EXCLUDED.intervention_attempt_count, journey_state.intervention_attempt_count)
        """,
        # ... params ...
    )
```

---

## Task 6: Full Test Suite

**Files:**
- Create/amend: `backend/tests/test_*.py`

**Requirements:**
- Template validation tests
- Send success/failure tests (mock ZeptoMail)
- Response detection tests (resume after intervention)
- Endpoint authorization tests (super-admin gate)
- State machine tests (not_started → in_progress → completed)
- No live ZeptoMail in CI

**Steps:**

- [ ] **Step 6.1: Write template tests** (Task 2.2 above)
- [ ] **Step 6.2: Write send tests (mocked ZeptoMail)**
- [ ] **Step 6.3: Write response detection tests** (Task 3.3 above)
- [ ] **Step 6.4: Write endpoint tests (auth gating)**
- [ ] **Step 6.5: Run full suite**

```bash
cd backend && pytest tests/test_intervention*.py -v
```

---

## Task 7: Scheduler Job Skeleton (Deferred to 3B)

**Files:**
- Amend: `backend/src/analytics/tasks.py`

**Steps:**

- [ ] **Step 7.1: Implement detect_interventions_to_send_daily (skeleton)**

```python
# @shared_task
# def send_interventions_daily():
#     """Daily scheduler: send interventions to users with intervention_status = not_started."""
#     # Implements retry logic: max_intervention_attempts, retry_interval_days
#     # Marks abandoned after max retries
#     # Deferred to sub-project 3B pending product approval
```

---

## Pre-Flight Checks

| Check | Status |
|---|---|
| Migration 0032 applies cleanly | [ ] |
| CustomerResponseType enum defined | [ ] |
| InterventionService sends emails (mocked) | [ ] |
| Response detection works (resume after intervention_sent_at) | [ ] |
| Super-admin endpoint gated + working | [ ] |
| All tests pass; no live ZeptoMail in CI | [ ] |
| Sub-Project 4 can query re-engagement % | [ ] |

---

## Success Criteria

- [x] Sub-Project 2 done (stall detection)
- [ ] **Task 1:** Migration 0032 + CustomerResponseType ✓
- [ ] **Task 2:** InterventionService + templates ✓
- [ ] **Task 3:** Response detection (resume logic) ✓
- [ ] **Task 4:** Manual super-admin endpoint ✓
- [ ] **Task 5:** Repo upsert amendments ✓
- [ ] **Task 6:** Full test suite passing ✓
- [ ] **Task 7:** Scheduler skeleton documented (3B) ✓
- [ ] All changes committed to `main`

---

## Out of Scope (Sub-Projects 3B, 4, 5+)

- Daily scheduler job (Celery beat, requires product approval)
- Email template A/B testing
- ZeptoMail delivery webhook (email open tracking)
- SMS/push notification channels
- Dashboards + re-engagement metrics (sub-project 4)
- ML-based send timing optimization

---

## Rollback Plan

If intervention sending causes issues:
1. Revert commit
2. Set `zeptomail_token = ""` in env (disables email)
3. Re-investigate with logs; no data loss (intervention_sent_at is new column)
