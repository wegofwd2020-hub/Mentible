"""Intervention service — send emails to stalled users (sub-project 3).

State-driven: Sub-Project 2 detects stalls → journey_state.intervention_status = not_started.
This service reads that state and sends templated emails via ZeptoMail.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from uuid import UUID

import asyncpg
import httpx

from backend.config import settings
from backend.src.analytics.models import DeviceClass, EventName, StallReason, CustomerResponseType
from backend.src.analytics.schemas import EventIn
from backend.src.analytics.repo import record_event, upsert_journey_state

logger = logging.getLogger(__name__)

# Email templates by stall_reason (sub-project 3)
STALL_REASON_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: {
        "subject": "Your content is ready—let's publish it 🚀",
        "body": """Hi there,

We noticed you've drafted some great content but haven't published yet.
Save and approve your work to activate it and start sharing with your audience.

👉 Resume in Mentible: {app_url}

Your draft is waiting for you!

Best,
The Mentible Team""",
    },
    StallReason.INVITE_UNRESPONDED: {
        "subject": "Your expert reviewers are waiting",
        "body": """Hi there,

You've invited expert reviewers to validate your content,
but we haven't heard back from them yet.

You can:
- Check in with your reviewers
- Add additional reviewers
- Proceed without validation

👉 Check your project: {app_url}

Best,
The Mentible Team""",
    },
    StallReason.PAYMENT_INCOMPLETE: {
        "subject": "Finish checkout to publish",
        "body": """Hi there,

You're one step away from publishing!
Complete your payment to unlock unlimited publishing.

👉 Complete checkout: {app_url}

Questions? We're here to help.

Best,
The Mentible Team""",
    },
    StallReason.INACTIVE: {
        "subject": "Welcome back! Let's finish your project",
        "body": """Hi there,

We haven't seen you in a while.
Your project is waiting for you—pick up where you left off.

👉 Open Mentible: {app_url}

We're here to help if you need anything.

Best,
The Mentible Team""",
    },
    StallReason.UNKNOWN: {
        "subject": "We noticed you've paused",
        "body": """Hi there,

We noticed you've paused your project.
Is there anything blocking you? We're here to help.

👉 Open Mentible: {app_url}

Just reply to this email or reach out to support@kaundinyalabs.com.

Best,
The Mentible Team""",
    },
}


class InterventionService:
    """Send intervention emails to stalled users; track response data."""

    @staticmethod
    async def send_intervention_for_user(
        conn: asyncpg.Connection,
        user_id: UUID,
        email: str,
        stall_reason: StallReason,
        journey_state_dict: dict,
        app_url: str = "https://mentible.app/",
    ) -> bool:
        """Send intervention email to one stalled user.

        Args:
            conn: asyncpg connection for event emission + journey_state update
            user_id: Account ID
            email: Email address to send to
            stall_reason: Which template to use
            journey_state_dict: journey_state row as dict
            app_url: Deep link URL for resume button

        Returns:
            True if email sent successfully, False otherwise

        Side effects:
            - Emits 'followup_email_sent' or 'followup_email_failed' event
            - Updates journey_state: intervention_sent_at = now, intervention_status = in_progress (if success)
        """
        # 1. Select template
        template = STALL_REASON_TEMPLATES.get(stall_reason)
        if not template:
            template = STALL_REASON_TEMPLATES[StallReason.UNKNOWN]

        # 2. Render email
        subject = template["subject"]
        body = template["body"].format(app_url=app_url)

        # 3. Send via ZeptoMail
        send_success = False
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{settings.zeptomail_base_url}/email",
                    headers={
                        "Authorization": settings.zeptomail_token,
                    },
                    json={
                        "from": {"address": settings.zeptomail_from, "name": "Mentible"},
                        "to": [{"email_address": {"address": email}}],
                        "subject": subject,
                        "textbody": body,  # Plain text for now (TODO: markdown → HTML)
                        "reply_to": {"address": settings.feedback_to},
                    },
                )
                send_success = resp.status_code == 200
                if not send_success:
                    logger.warning(
                        f"ZeptoMail returned {resp.status_code} for user {user_id}: {resp.text[:200]}"
                    )
        except Exception as e:
            logger.warning(f"ZeptoMail send exception for user {user_id}: {e}")
            send_success = False

        # 4. Emit event (always, even on send failure)
        try:
            event_name = EventName.FOLLOWUP_EMAIL_SENT if send_success else EventName.FOLLOWUP_EMAIL_FAILED
            await record_event(
                conn,
                event=EventIn(
                    event_name=event_name,
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
        except Exception as e:
            logger.warning(f"Failed to emit intervention event for {user_id}: {e}")

        # 5. Update journey_state (only on success)
        if send_success:
            try:
                await upsert_journey_state(
                    conn,
                    user_id=user_id,
                    current_journey_stage=journey_state_dict["current_journey_stage"],
                    stage_status=journey_state_dict["stage_status"],
                    last_meaningful_event=journey_state_dict.get("last_meaningful_event"),
                    last_meaningful_event_at=journey_state_dict.get("last_meaningful_event_at"),
                    stalled_at=journey_state_dict.get("stalled_at"),
                    stall_reason=journey_state_dict.get("stall_reason"),
                    intervention_sent_at=datetime.now(UTC),
                    intervention_status="in_progress",
                    intervention_attempt_count=(journey_state_dict.get("intervention_attempt_count", 0) or 0) + 1,
                )
            except Exception as e:
                logger.warning(f"Failed to update journey_state for {user_id} after send: {e}")

        return send_success
