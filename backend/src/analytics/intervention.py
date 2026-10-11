"""Intervention service — send emails to stalled users (sub-project 3).

State-driven: Sub-Project 2 detects stalls → journey_state.intervention_status = not_started.
This service reads that state and sends templated emails via ZeptoMail.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

import asyncpg

from backend.config import settings
from backend.src.analytics.models import DeviceClass, EventName, StallReason
from backend.src.analytics.repo import record_event, upsert_journey_state
from backend.src.analytics.schemas import EventIn
from backend.src.email.html_templates import get_html_email_template, render_html_body
from backend.src.email.sender import send_html_email

logger = logging.getLogger(__name__)


def coerce_stall_reason(value: object) -> StallReason:
    """Normalise a stored stall reason to the enum.

    journey_state holds plain strings, and rows written by older code are
    uppercase (e.g. NO_MEANINGFUL_ACTION). Unknown values fall back to UNKNOWN.
    """
    if isinstance(value, StallReason):
        return value
    try:
        return StallReason(str(value).lower())
    except ValueError:
        return StallReason.UNKNOWN


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
        stall_reason = coerce_stall_reason(stall_reason)

        # 1. Select template by stall_reason + attempt_count (escalating)
        attempt_count = (journey_state_dict.get("intervention_attempt_count", 0) or 0) + 1
        email_template = get_html_email_template(stall_reason, attempt_count)

        # 2. Render email
        subject = email_template.subject
        html_body = render_html_body(email_template.html_body, app_url)

        # 3. Send via the configured provider (ZeptoMail or SMTP)
        send_success = await send_html_email(
            to=email,
            subject=f"{settings.intervention_subject_prefix}{subject}",
            html_body=html_body,
            reply_to=settings.feedback_to,
        )

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
                        # No recipient email here: analytics properties reject
                        # email-like keys (PII guard), which silently dropped
                        # this event on every send.
                        "stall_reason": stall_reason.value,
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
