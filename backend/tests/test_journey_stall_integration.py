"""Integration tests: journey evaluator + stall detection (sub-project 2)."""

from datetime import datetime, timedelta, UTC
from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.models import JourneyStage, StageStatus, StallReason

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _event(name, occurred_at=T0, **props):
    """Factory for test events."""
    return {"event_name": name, "occurred_at": occurred_at, "properties": props}


def test_stall_detection_skipped_when_no_thresholds():
    """Stall detection is disabled if thresholds is None."""
    now = T0 + timedelta(days=8)
    events = [
        _event("signup_completed", T0),
        # Inactive for 8 days
    ]
    thresholds = None

    result = evaluate_journey_state(events, thresholds=thresholds, current_time=now)
    assert result.stage_status == StageStatus.IN_PROGRESS
    assert result.stalled_at is None
    assert result.stall_reason is None


def test_stall_detection_integration_time_based():
    """Journey evaluator calls stall detection and sets stage_status=STALLED."""
    now = T0 + timedelta(days=8)
    events = [
        _event("signup_completed", T0),
        # Inactive for 8 days
    ]
    thresholds = {"create_first_value": 7}

    result = evaluate_journey_state(events, thresholds=thresholds, current_time=now)
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE
    assert result.stage_status == StageStatus.STALLED
    assert result.stalled_at is not None
    assert result.stall_reason == StallReason.INACTIVE


def test_stall_detection_integration_generation_loop():
    """Journey evaluator detects generation loop pattern."""
    now = T0 + timedelta(minutes=30)
    events = [
        _event("signup_completed", T0),
        _event("generation_completed", T0 + timedelta(minutes=5)),
        _event("generation_completed", T0 + timedelta(minutes=10)),
        _event("generation_completed", T0 + timedelta(minutes=15)),
        _event("generation_completed", T0 + timedelta(minutes=20)),
        _event("generation_completed", T0 + timedelta(minutes=25)),
        # 5 generations, 0 meaningful actions
    ]
    thresholds = {"create_first_value": 7}

    result = evaluate_journey_state(events, thresholds=thresholds, current_time=now)
    assert result.stage_status == StageStatus.STALLED
    assert result.stall_reason == StallReason.NO_MEANINGFUL_ACTION


def test_no_stall_when_active():
    """No stall when user is still active."""
    now = T0 + timedelta(days=3)
    events = [
        _event("signup_completed", T0),
        # Inactive for 3 days (below 7-day threshold)
    ]
    thresholds = {"create_first_value": 7}

    result = evaluate_journey_state(events, thresholds=thresholds, current_time=now)
    assert result.stage_status == StageStatus.IN_PROGRESS
    assert result.stalled_at is None
    assert result.stall_reason is None


def test_stall_not_checked_when_completed():
    """Stall detection skipped if stage_status is COMPLETED."""
    now = T0 + timedelta(days=50)
    events = [
        _event("signup_completed", T0),
        _event("meaningful_action_completed", T0 + timedelta(days=1), action_type="save"),
        _event("review_completed", T0 + timedelta(days=2)),
        _event("export_completed", T0 + timedelta(days=3)),
        _event("second_project_created", T0 + timedelta(days=4)),
        # 50 days of inactivity after completion
    ]
    thresholds = {"return_advocate": 21}

    result = evaluate_journey_state(events, thresholds=thresholds, current_time=now)
    assert result.stage_status == StageStatus.COMPLETED
    assert result.stalled_at is None
    assert result.stall_reason is None
