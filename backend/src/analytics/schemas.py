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
                raise PrivacyViolation(
                    f"properties key '{key}' looks like sensitive data (matches '{fragment}')"
                )
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
