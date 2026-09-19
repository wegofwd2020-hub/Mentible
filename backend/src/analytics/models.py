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


class StallReason(StrEnum):
    """Why a user's journey stalled (sub-project 2)."""
    NO_MEANINGFUL_ACTION = "no_meaningful_action"
    INVITE_UNRESPONDED = "invite_unresponded"
    PAYMENT_INCOMPLETE = "payment_incomplete"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"


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
