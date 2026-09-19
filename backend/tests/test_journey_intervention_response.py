"""Tests for journey response detection to interventions (sub-project 3)."""

from datetime import UTC, datetime, timedelta
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.models import JourneyStage, StageStatus, CustomerResponseType

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _event(name, occurred_at=T0, **props):
    """Factory for test events."""
    return {"event_name": name, "occurred_at": occurred_at, "properties": props}


def test_no_customer_response_type_without_intervention_sent_at():
    """customer_response_type is None if intervention was never sent."""
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
    ]

    result = evaluate_journey_state(events)
    assert result.customer_response_type is None


def test_no_customer_response_type_if_no_action_after_intervention():
    """customer_response_type stays None if user doesn't act after intervention."""
    intervention_time = T0 + timedelta(days=8)
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
        # intervention_sent_at = T0 + 8 days
        # but no meaningful action after that
    ]

    result = evaluate_journey_state(
        events,
        intervention_sent_at=intervention_time,
    )
    assert result.customer_response_type is None


def test_customer_response_type_resumed_journey_on_action_after_intervention():
    """Meaningful action after intervention_sent_at → customer_response_type = resumed_journey."""
    intervention_time = T0 + timedelta(days=8)
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
        # intervention sent at T0 + 8 days
        _event("meaningful_action_completed", T0 + timedelta(days=9), action_type="edit"),
    ]

    result = evaluate_journey_state(
        events,
        intervention_sent_at=intervention_time,
    )
    assert result.customer_response_type == CustomerResponseType.RESUMED_JOURNEY


def test_non_meaningful_action_does_not_count_as_response():
    """Viewing/opening the draft is not a meaningful action (AC3)."""
    intervention_time = T0 + timedelta(days=8)
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
        # intervention sent at T0 + 8 days
        _event("meaningful_action_completed", T0 + timedelta(days=9), action_type="view"),
    ]

    result = evaluate_journey_state(
        events,
        intervention_sent_at=intervention_time,
    )
    # "view" is not a qualifying action type, so no response
    assert result.customer_response_type is None


def test_intervention_sent_at_passed_through():
    """intervention_sent_at is passed through to result."""
    intervention_time = T0 + timedelta(days=8)
    events = [_event("signup_completed", T0)]

    result = evaluate_journey_state(
        events,
        intervention_sent_at=intervention_time,
    )
    assert result.intervention_sent_at == intervention_time


def test_multiple_meaningful_actions_after_intervention():
    """If any meaningful action occurs after intervention, it counts as response."""
    intervention_time = T0 + timedelta(days=8)
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
        # intervention sent at T0 + 8 days
        _event("meaningful_action_completed", T0 + timedelta(days=9), action_type="view"),  # doesn't count
        _event("meaningful_action_completed", T0 + timedelta(days=10), action_type="approve"),  # counts
    ]

    result = evaluate_journey_state(
        events,
        intervention_sent_at=intervention_time,
    )
    assert result.customer_response_type == CustomerResponseType.RESUMED_JOURNEY
