"""Unit tests for stall detection engine (sub-project 2)."""

from __future__ import annotations

import pytest
from datetime import datetime, timedelta, UTC
from uuid import uuid4

from backend.src.analytics.models import StallReason
from backend.src.analytics.stall import detect_stall


@pytest.fixture
def user_id():
    """Sample user ID."""
    return uuid4()


@pytest.fixture
def thresholds():
    """Standard stall thresholds."""
    return {
        "discover_join": 7,
        "create_first_value": 7,
        "refine_validate": 10,
        "finish_pay": 14,
        "return_advocate": 21,
    }


def make_event(name: str, occurred_at: datetime) -> dict:
    """Factory for test events (minimal dict)."""
    return {
        "event_name": name,
        "occurred_at": occurred_at,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Time-based stall detection tests (table-driven by stage)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "stage,threshold_days,inactive_days,expected_stall",
    [
        ("discover_join", 7, 8, True),  # 1 day past threshold
        ("discover_join", 7, 7, False),  # exactly at threshold (not past)
        ("discover_join", 7, 6, False),  # still within threshold
        ("create_first_value", 7, 8, True),
        ("refine_validate", 10, 11, True),
        ("finish_pay", 14, 15, True),
        ("return_advocate", 21, 22, True),
    ],
)
def test_stall_detection_time_based(user_id, stage, threshold_days, inactive_days, expected_stall):
    """Time-based stall detection: inactivity > threshold → stalled."""
    now = datetime.now(UTC)
    last_event = now - timedelta(days=inactive_days)
    thresholds = {stage: threshold_days}

    result = detect_stall(
        user_id=user_id,
        current_stage=stage,
        last_meaningful_event_at=last_event,
        events_in_stage=[],
        current_time=now,
        thresholds=thresholds,
    )

    assert result.is_stalled == expected_stall
    if expected_stall:
        assert result.stall_reason == StallReason.INACTIVE
    else:
        assert result.stall_reason is None


def test_stall_no_events_yet(user_id, thresholds):
    """No previous events → not stalled."""
    now = datetime.now(UTC)
    result = detect_stall(
        user_id=user_id,
        current_stage="discover_join",
        last_meaningful_event_at=None,
        events_in_stage=[],
        current_time=now,
        thresholds=thresholds,
    )

    assert not result.is_stalled
    assert result.stall_reason is None


def test_stall_unknown_stage(user_id, thresholds):
    """Unknown stage → not stalled."""
    now = datetime.now(UTC)
    result = detect_stall(
        user_id=user_id,
        current_stage="unknown_stage",
        last_meaningful_event_at=now - timedelta(days=100),
        events_in_stage=[],
        current_time=now,
        thresholds=thresholds,
    )

    assert not result.is_stalled
    assert result.stall_reason is None


# ─────────────────────────────────────────────────────────────────────────────
# Pattern-based stall detection tests
# ─────────────────────────────────────────────────────────────────────────────


def test_stall_generation_loop_5_gens_0_saves(user_id):
    """Generation loop: 5+ generations, 0 saves → no_meaningful_action."""
    now = datetime.now(UTC)
    events = [
        make_event("generation_completed", now - timedelta(minutes=30)),
        make_event("generation_completed", now - timedelta(minutes=25)),
        make_event("generation_completed", now - timedelta(minutes=20)),
        make_event("generation_completed", now - timedelta(minutes=15)),
        make_event("generation_completed", now - timedelta(minutes=10)),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="create_first_value",
        last_meaningful_event_at=now - timedelta(minutes=10),
        events_in_stage=events,
        current_time=now,
        thresholds={"create_first_value": 7},
    )

    assert result.is_stalled
    assert result.stall_reason == StallReason.NO_MEANINGFUL_ACTION


def test_stall_no_generation_loop_if_saves_exist(user_id):
    """Generation loop: 5 generations BUT has saves → not stalled."""
    now = datetime.now(UTC)
    events = [
        make_event("generation_completed", now - timedelta(minutes=30)),
        make_event("generation_completed", now - timedelta(minutes=25)),
        make_event("meaningful_action_completed", now - timedelta(minutes=20)),
        make_event("generation_completed", now - timedelta(minutes=15)),
        make_event("generation_completed", now - timedelta(minutes=10)),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="create_first_value",
        last_meaningful_event_at=now - timedelta(minutes=10),
        events_in_stage=events,
        current_time=now,
        thresholds={"create_first_value": 7},
    )

    assert not result.is_stalled


def test_stall_no_generation_loop_if_under_threshold(user_id):
    """Generation loop: only 4 generations → not stalled (under 5-gen threshold)."""
    now = datetime.now(UTC)
    events = [
        make_event("generation_completed", now - timedelta(minutes=30)),
        make_event("generation_completed", now - timedelta(minutes=20)),
        make_event("generation_completed", now - timedelta(minutes=15)),
        make_event("generation_completed", now - timedelta(minutes=10)),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="create_first_value",
        last_meaningful_event_at=now - timedelta(minutes=10),
        events_in_stage=events,
        current_time=now,
        thresholds={"create_first_value": 7},
    )

    assert not result.is_stalled


def test_stall_invite_unresponded_10_days_no_review(user_id):
    """Invite unresponded: invited 11 days ago, 0 reviews → invite_unresponded."""
    now = datetime.now(UTC)
    invite_time = now - timedelta(days=11)
    events = [
        make_event("reviewer_invited", invite_time),
        # No review_completed after invite
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="refine_validate",
        last_meaningful_event_at=invite_time,
        events_in_stage=events,
        current_time=now,
        thresholds={"refine_validate": 10},
    )

    assert result.is_stalled
    assert result.stall_reason == StallReason.INVITE_UNRESPONDED


def test_stall_no_invite_unresponded_if_under_10_days(user_id):
    """Invite unresponded: invited only 5 days ago → not stalled."""
    now = datetime.now(UTC)
    invite_time = now - timedelta(days=5)
    events = [make_event("reviewer_invited", invite_time)]

    result = detect_stall(
        user_id=user_id,
        current_stage="refine_validate",
        last_meaningful_event_at=invite_time,
        events_in_stage=events,
        current_time=now,
        thresholds={"refine_validate": 10},
    )

    assert not result.is_stalled


def test_stall_no_invite_unresponded_if_response_received(user_id):
    """Invite unresponded: invited 11 days ago, but review_completed received → not stalled."""
    now = datetime.now(UTC)
    invite_time = now - timedelta(days=11)
    review_time = now - timedelta(days=5)
    events = [
        make_event("reviewer_invited", invite_time),
        make_event("review_completed", review_time),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="refine_validate",
        last_meaningful_event_at=review_time,
        events_in_stage=events,
        current_time=now,
        thresholds={"refine_validate": 10},
    )

    assert not result.is_stalled


def test_stall_payment_abandoned_checkout_not_completed(user_id):
    """Payment abandoned: checkout_started but never checkout_completed → payment_incomplete."""
    now = datetime.now(UTC)
    checkout_start = now - timedelta(minutes=30)
    events = [make_event("checkout_started", checkout_start)]

    result = detect_stall(
        user_id=user_id,
        current_stage="finish_pay",
        last_meaningful_event_at=checkout_start,
        events_in_stage=events,
        current_time=now,
        thresholds={"finish_pay": 14},
    )

    assert result.is_stalled
    assert result.stall_reason == StallReason.PAYMENT_INCOMPLETE


def test_stall_no_payment_abandoned_if_completed(user_id):
    """Payment abandoned: checkout_started AND checkout_completed → not stalled."""
    now = datetime.now(UTC)
    checkout_start = now - timedelta(minutes=30)
    checkout_complete = now - timedelta(minutes=5)
    events = [
        make_event("checkout_started", checkout_start),
        make_event("checkout_completed", checkout_complete),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="finish_pay",
        last_meaningful_event_at=checkout_complete,
        events_in_stage=events,
        current_time=now,
        thresholds={"finish_pay": 14},
    )

    assert not result.is_stalled


def test_stall_no_payment_abandoned_if_not_started(user_id):
    """Payment abandoned: no checkout_started at all → not stalled."""
    now = datetime.now(UTC)
    events = []

    result = detect_stall(
        user_id=user_id,
        current_stage="finish_pay",
        last_meaningful_event_at=now - timedelta(days=5),
        events_in_stage=events,
        current_time=now,
        thresholds={"finish_pay": 14},
    )

    # Would be time-based stall (5 days < 14 days threshold), not payment
    assert not result.is_stalled


# ─────────────────────────────────────────────────────────────────────────────
# Priority and override rules
# ─────────────────────────────────────────────────────────────────────────────


def test_pattern_overrides_time_based_stall(user_id):
    """Pattern match takes priority over time-based stall reason."""
    now = datetime.now(UTC)
    # Inactive for 8 days (time-based stall), but also has 5 gens + 0 saves (pattern match)
    events = [
        make_event("generation_completed", now - timedelta(days=7)),
        make_event("generation_completed", now - timedelta(days=6)),
        make_event("generation_completed", now - timedelta(days=5)),
        make_event("generation_completed", now - timedelta(days=4)),
        make_event("generation_completed", now - timedelta(days=3)),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="create_first_value",
        last_meaningful_event_at=now - timedelta(days=8),
        events_in_stage=events,
        current_time=now,
        thresholds={"create_first_value": 7},
    )

    # Pattern match (generation loop) takes priority
    assert result.is_stalled
    assert result.stall_reason == StallReason.NO_MEANINGFUL_ACTION


def test_multiple_patterns_first_match_wins(user_id):
    """If multiple patterns match, the one checked first wins (no tie-breaking)."""
    # This is a degenerate case (user in finish_pay with checkout + invite),
    # but tests the priority: payment check runs before invite check in
    # the _check_pattern_stalls dispatch.
    now = datetime.now(UTC)
    events = [
        make_event("checkout_started", now - timedelta(minutes=30)),
        make_event("reviewer_invited", now - timedelta(days=15)),
    ]

    result = detect_stall(
        user_id=user_id,
        current_stage="finish_pay",
        last_meaningful_event_at=now - timedelta(minutes=30),
        events_in_stage=events,
        current_time=now,
        thresholds={"finish_pay": 14},
    )

    assert result.is_stalled
    assert result.stall_reason == StallReason.PAYMENT_INCOMPLETE


# ─────────────────────────────────────────────────────────────────────────────
# Edge cases
# ─────────────────────────────────────────────────────────────────────────────


def test_stall_exactly_at_threshold_boundary(user_id):
    """Stall threshold is strictly greater-than, not greater-or-equal."""
    now = datetime.now(UTC)
    # Exactly 7 days ago (not past the 7-day threshold)
    last_event = now - timedelta(days=7)

    result = detect_stall(
        user_id=user_id,
        current_stage="discover_join",
        last_meaningful_event_at=last_event,
        events_in_stage=[],
        current_time=now,
        thresholds={"discover_join": 7},
    )

    # Not stalled (must be PAST the threshold, not equal to it)
    assert not result.is_stalled


def test_stall_just_past_threshold(user_id):
    """Stall is detected just past the threshold."""
    now = datetime.now(UTC)
    # 7 days + 1 second past threshold
    last_event = now - timedelta(days=7, seconds=1)

    result = detect_stall(
        user_id=user_id,
        current_stage="discover_join",
        last_meaningful_event_at=last_event,
        events_in_stage=[],
        current_time=now,
        thresholds={"discover_join": 7},
    )

    # Stalled
    assert result.is_stalled
    assert result.stall_reason == StallReason.INACTIVE
