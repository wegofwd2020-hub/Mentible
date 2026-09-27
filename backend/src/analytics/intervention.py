"""Intervention service — send emails to stalled users (sub-project 3).

State-driven: Sub-Project 2 detects stalls → journey_state.intervention_status = not_started.
This service reads that state and sends templated emails via ZeptoMail.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

import asyncpg
import httpx

from backend.config import settings
from backend.src.analytics.email_templates import get_email_template
from backend.src.analytics.models import DeviceClass, EventName, StallReason
from backend.src.analytics.repo import record_event, upsert_journey_state
from backend.src.analytics.schemas import EventIn

logger = logging.getLogger(__name__)


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
        # 1. Select template by stall_reason + attempt_count (escalating)
        attempt_count = (journey_state_dict.get("intervention_attempt_count", 0) or 0) + 1
        email_template = get_email_template(stall_reason, attempt_count)

        # 2. Render email
        subject = email_template.subject
        body = email_template.body.format(app_url=app_url)

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
            event_name = (
                EventName.FOLLOWUP_EMAIL_SENT if send_success else EventName.FOLLOWUP_EMAIL_FAILED
            )
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
                    intervention_attempt_count=(
                        journey_state_dict.get("intervention_attempt_count", 0) or 0
                    )
                    + 1,
                )
            except Exception as e:
                logger.warning(f"Failed to update journey_state for {user_id} after send: {e}")

        return send_success
