"""Common Event Contract (design doc §"Data model") and the privacy enforcement boundary
(AC9): no manuscript text, prompts, reviewer comments, emails, or payment details may enter
an event's `properties` payload."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


# Dashboard response schemas (sub-project 4)


class ReEngagementRowSchema(BaseModel):
    """Re-engagement rate by stall reason — for dashboard metric 1."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "stall_reason": "no_meaningful_action",
                "total_stalled": 100,
                "resumed": 50,
                "re_engagement_rate_pct": 50.0,
            }
        }
    )

    stall_reason: str = Field(..., description="Stall reason enum value")
    total_stalled: int = Field(..., ge=0, description="Total users who stalled")
    resumed: int = Field(..., ge=0, description="Users who resumed after intervention")
    re_engagement_rate_pct: float = Field(
        ..., ge=0.0, le=100.0, description="Re-engagement rate percentage"
    )


class TTFRRowSchema(BaseModel):
    """Time-to-first-response distribution — for dashboard metric 2."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "stall_reason": "invite_unresponded",
                "responded_count": 30,
                "p50_seconds": 3600,
                "p95_seconds": 86400,
            }
        }
    )

    stall_reason: str = Field(..., description="Stall reason enum value")
    responded_count: int = Field(..., ge=0, description="Users who responded")
    p50_seconds: int | None = Field(None, ge=0, description="Median response time in seconds")
    p95_seconds: int | None = Field(
        None, ge=0, description="95th percentile response time in seconds"
    )


class ResponseRateMetricSchema(BaseModel):
    """Overall response rate — for dashboard metric 3."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {"response_rate": 0.65, "no_response_count": 35, "total_interventions": 100}
        }
    )

    response_rate: float = Field(
        ..., ge=0.0, le=1.0, description="Fraction of users who responded (0.0-1.0)"
    )
    no_response_count: int = Field(..., ge=0, description="Users with no response")
    total_interventions: int = Field(..., ge=0, description="Total interventions sent")


class RetryEffectivenessRowSchema(BaseModel):
    """Retry effectiveness — success rate by attempt number — for dashboard metric 4."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "attempt_count": 1,
                "attempts_made": 100,
                "resumed": 60,
                "success_rate_pct": 60.0,
            }
        }
    )

    attempt_count: int = Field(..., ge=1, description="Attempt number (1, 2, ...)")
    attempts_made: int = Field(..., ge=0, description="Number of interventions at this attempt")
    resumed: int = Field(..., ge=0, description="Users who resumed at this attempt")
    success_rate_pct: float = Field(..., ge=0.0, le=100.0, description="Success rate percentage")


class StageMetricRowSchema(BaseModel):
    """Stall breakdown by journey stage — how many users stalled at each stage."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "journey_stage": "create_first_value",
                "total_stalled": 25,
                "avg_time_in_stage_hours": 48.5,
                "stall_rate_pct": 12.5,
            }
        }
    )

    journey_stage: str = Field(..., description="Journey stage enum value")
    total_stalled: int = Field(..., ge=0, description="Users who stalled at this stage")
    avg_time_in_stage_hours: float | None = Field(
        None, ge=0, description="Average hours spent in stage before stalling"
    )
    stall_rate_pct: float = Field(
        ..., ge=0.0, le=100.0, description="Percentage of users reaching this stage who stalled"
    )


class ProjectBottleneckRowSchema(BaseModel):
    """Per-project stage bottleneck — shows where users are getting stuck."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "550e8400-e29b-41d4-a716-446655440000",
                "journey_stage": "refine_validate",
                "total_users_at_stage": 15,
                "stalled_count": 6,
                "stall_rate_pct": 40.0,
                "avg_hours_before_stall": 72.5,
                "intervention_sent_count": 4,
                "resumed_after_intervention_count": 1,
                "re_engagement_rate_pct": 25.0,
            }
        }
    )

    project_id: str = Field(..., description="Project UUID")
    journey_stage: str = Field(..., description="Journey stage enum value")
    total_users_at_stage: int = Field(..., ge=0, description="Total users at this stage in project")
    stalled_count: int = Field(..., ge=0, description="Users who stalled at this stage")
    stall_rate_pct: float = Field(
        ..., ge=0.0, le=100.0, description="Dropout rate at this stage (%)"
    )
    avg_hours_before_stall: float | None = Field(None, ge=0, description="Avg hours before stall")
    intervention_sent_count: int = Field(..., ge=0, description="Intervention emails sent")
    resumed_after_intervention_count: int = Field(
        ..., ge=0, description="Resumed after intervention"
    )
    re_engagement_rate_pct: float | None = Field(
        None, ge=0.0, le=100.0, description="% who resumed after intervention"
    )


class FunnelRowSchema(BaseModel):
    """Completion funnel: % advancing from stage N to N+1."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "550e8400-e29b-41d4-a716-446655440000",
                "from_stage": "create_first_value",
                "to_stage": "refine_validate",
                "users_at_from_stage": 50,
                "users_advanced": 30,
                "advancement_rate_pct": 60.0,
            }
        }
    )

    project_id: str = Field(..., description="Project UUID")
    from_stage: str = Field(..., description="Starting journey stage")
    to_stage: str = Field(..., description="Next journey stage")
    users_at_from_stage: int = Field(..., ge=0, description="Users in from_stage")
    users_advanced: int = Field(..., ge=0, description="Users who advanced to to_stage")
    advancement_rate_pct: float = Field(..., ge=0.0, le=100.0, description="Advancement rate (%)")


class StalledUserRowSchema(BaseModel):
    """User stuck at a stage in a project — for ops/support view."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "email": "user@example.com",
                "project_id": "660e8400-e29b-41d4-a716-446655440000",
                "project_name": "My First Book",
                "journey_stage": "refine_validate",
                "stalled_at": "2026-09-15T10:30:00Z",
                "days_stalled": 12,
                "intervention_attempt_count": 1,
                "last_intervention_sent_at": "2026-09-20T08:00:00Z",
            }
        }
    )

    user_id: str = Field(..., description="User UUID")
    email: str = Field(..., description="User email (for outreach)")
    project_id: str = Field(..., description="Project UUID")
    project_name: str = Field(..., description="Project name")
    journey_stage: str = Field(..., description="Stage where user stalled")
    stalled_at: str = Field(..., description="ISO timestamp when stall was detected")
    days_stalled: int = Field(..., ge=0, description="Days since stall detected")
    intervention_attempt_count: int = Field(..., ge=0, description="Intervention emails sent")
    last_intervention_sent_at: str | None = Field(None, description="ISO timestamp of last email")


class DashboardResponseSchema(BaseModel):
    """Aggregated dashboard metrics — all 4 core metrics for intervention overview."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "re_engagement": [
                    {
                        "stall_reason": "invite_unresponded",
                        "total_stalled": 50,
                        "resumed": 50,
                        "re_engagement_rate_pct": 100.0,
                    }
                ],
                "ttfr": [
                    {
                        "stall_reason": "invite_unresponded",
                        "responded_count": 50,
                        "p50_seconds": 3600,
                        "p95_seconds": 86400,
                    }
                ],
                "response_rate": {
                    "response_rate": 0.65,
                    "no_response_count": 35,
                    "total_interventions": 100,
                },
                "retry_effectiveness": [
                    {
                        "attempt_count": 1,
                        "attempts_made": 100,
                        "resumed": 60,
                        "success_rate_pct": 60.0,
                    }
                ],
                "stall_by_stage": [
                    {
                        "journey_stage": "create_first_value",
                        "total_stalled": 25,
                        "avg_time_in_stage_hours": 48.5,
                        "stall_rate_pct": 12.5,
                    }
                ],
            }
        }
    )

    re_engagement: list[ReEngagementRowSchema] = Field(
        ..., description="Re-engagement rate by stall reason (sorted by rate DESC)"
    )
    ttfr: list[TTFRRowSchema] = Field(..., description="TTFR distribution by stall reason")
    response_rate: ResponseRateMetricSchema = Field(..., description="Overall response rate metric")
    retry_effectiveness: list[RetryEffectivenessRowSchema] = Field(
        ..., description="Retry effectiveness by attempt count (sorted by attempt ASC)"
    )
    stall_by_stage: list[StageMetricRowSchema] = Field(
        ..., description="Stall breakdown by journey stage (sorted by stall_rate_pct DESC)"
    )
