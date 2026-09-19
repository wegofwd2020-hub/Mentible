"""Stall detection engine (sub-project 2).

Pure function detect_stall() identifies when users get stuck in a journey stage
and categorizes the reason (behavioral loop, payment abandoned, invite unresponded,
inactivity timeout).

No DB calls; deterministic and testable against event history.
Events are dicts with at least 'event_name' and 'occurred_at' keys.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import NamedTuple, TypedDict
from uuid import UUID

from backend.src.analytics.models import JourneyStage, StallReason


class Event(TypedDict, total=False):
    """Event dict shape (at minimum; sub-projects may add fields)."""
    event_name: str
    occurred_at: datetime


class StallResult(NamedTuple):
    """Result of stall detection."""
    is_stalled: bool
    stall_reason: StallReason | None


def detect_stall(
    user_id: UUID,
    current_stage: str,
    last_meaningful_event_at: datetime | None,
    events_in_stage: list[Event],
    current_time: datetime,
    thresholds: dict[str, int],
) -> StallResult:
    """Detect if a user is stalled in their current journey stage.

    Args:
        user_id: Account ID (for logging/debugging).
        current_stage: Current journey_stage value.
        last_meaningful_event_at: Timestamp of the most recent meaningful event.
        events_in_stage: All events recorded while in this stage (dicts with 'event_name', 'occurred_at').
        current_time: Reference time for duration calculations.
        thresholds: Dict of stage → days (from config.stall_thresholds).

    Returns:
        StallResult(is_stalled, stall_reason):
        - is_stalled: True if any stall condition matches.
        - stall_reason: Specific reason, or None if not stalled.

    Pure function; deterministic; rebuildable from event history.
    """

    if not last_meaningful_event_at:
        # No events yet; can't determine stall
        return StallResult(False, None)

    # Get time threshold for this stage
    threshold_days = thresholds.get(current_stage)
    if threshold_days is None:
        # Unknown stage; don't stall
        return StallResult(False, None)

    # Time-based inactivity check
    time_since_last_event = current_time - last_meaningful_event_at
    time_threshold = timedelta(days=threshold_days)
    time_based_stall = time_since_last_event > time_threshold

    # Pattern-based checks (override time-based if matched)
    stall_reason = _check_pattern_stalls(current_stage, events_in_stage, current_time)

    # If pattern detected, use that; otherwise fall back to time-based
    if stall_reason:
        return StallResult(True, stall_reason)
    elif time_based_stall:
        return StallResult(True, StallReason.INACTIVE)
    else:
        return StallResult(False, None)


def _check_pattern_stalls(
    stage: str,
    events: list[Event],
    current_time: datetime,
) -> StallReason | None:
    """Check for behavioral patterns that indicate stall."""

    if stage == JourneyStage.CREATE_FIRST_VALUE:
        return _check_generation_loop(events)
    elif stage == JourneyStage.REFINE_VALIDATE:
        return _check_invite_unresponded(events, current_time)
    elif stage == JourneyStage.FINISH_PAY:
        return _check_payment_abandoned(events)

    return None


def _check_generation_loop(events: list[Event]) -> StallReason | None:
    """Check for 5+ generations without save/approve/edit.

    Pattern rule: 5+ `generation_completed` events in stage, 0 `meaningful_action_completed`.
    Indicates user is looping on generation but not committing to edits.
    """
    gen_count = sum(1 for e in events if e["event_name"] == "generation_completed")
    action_count = sum(1 for e in events if e["event_name"] == "meaningful_action_completed")

    if gen_count >= 5 and action_count == 0:
        return StallReason.NO_MEANINGFUL_ACTION
    return None


def _check_invite_unresponded(
    events: list[Event],
    current_time: datetime,
) -> StallReason | None:
    """Check for expert review invited but no response.

    Pattern rule: Expert review invited; 0 reviewer responses after 10 days.
    Indicates the invited reviewer is unresponsive or has not engaged.
    """
    # Find "reviewer_invited" events
    invite_events = [e for e in events if e["event_name"] == "reviewer_invited"]
    if not invite_events:
        return None

    # Get the most recent invite
    latest_invite = max(invite_events, key=lambda e: e["occurred_at"])
    time_since_invite = current_time - latest_invite["occurred_at"]

    # Check for any reviewer responses after the invite
    response_events = [e for e in events if e["event_name"] == "review_completed" and e["occurred_at"] > latest_invite["occurred_at"]]

    if not response_events and time_since_invite > timedelta(days=10):
        return StallReason.INVITE_UNRESPONDED
    return None


def _check_payment_abandoned(events: list[Event]) -> StallReason | None:
    """Check for checkout started but not completed.

    Pattern rule: checkout_started fired, but checkout_completed never follows.
    Indicates user abandoned the payment flow.
    """
    checkout_start = any(e["event_name"] == "checkout_started" for e in events)
    checkout_complete = any(e["event_name"] == "checkout_completed" for e in events)

    if checkout_start and not checkout_complete:
        return StallReason.PAYMENT_INCOMPLETE
    return None
