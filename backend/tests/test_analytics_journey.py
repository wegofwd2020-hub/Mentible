from datetime import UTC, datetime

from backend.src.analytics.journey import evaluate_journey_state
from backend.src.analytics.models import JourneyStage, StageStatus

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _event(name, **props):
    return {"event_name": name, "occurred_at": T0, "properties": props}


def test_no_events_is_not_started_at_discover_join():
    result = evaluate_journey_state([])
    assert result.current_journey_stage == JourneyStage.DISCOVER_JOIN
    assert result.stage_status == StageStatus.NOT_STARTED


def test_signup_completed_advances_to_create_first_value_in_progress():
    result = evaluate_journey_state([_event("signup_completed")])
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE
    assert result.stage_status == StageStatus.IN_PROGRESS


def test_generation_completed_alone_does_not_activate_user():
    """AC3 / the doc's Primary Activation Decision: draft generation without a
    meaningful follow-up action is NOT activation."""
    result = evaluate_journey_state([_event("signup_completed"), _event("generation_completed")])
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE
    assert result.stage_status == StageStatus.IN_PROGRESS
    assert result.last_meaningful_event != "generation_completed"


def test_meaningful_action_completed_with_edit_advances_to_refine_validate():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("generation_completed"),
            _event("meaningful_action_completed", action_type="edit"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.REFINE_VALIDATE
    assert result.stage_status == StageStatus.IN_PROGRESS
    assert result.last_meaningful_event == "meaningful_action_completed"


def test_meaningful_action_completed_requires_qualifying_action_type():
    """Opening/scrolling a draft does not qualify (Meaningful Action Rules)."""
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="view"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.CREATE_FIRST_VALUE


def test_review_completed_advances_to_finish_pay():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="save"),
            _event("review_completed"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.FINISH_PAY


def test_export_completed_advances_to_return_advocate_completed():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="approve"),
            _event("review_completed"),
            _event("export_completed"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.RETURN_ADVOCATE
    assert result.stage_status == StageStatus.IN_PROGRESS


def test_second_project_created_marks_return_advocate_completed():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="continue"),
            _event("export_completed"),
            _event("second_project_created"),
        ]
    )
    assert result.current_journey_stage == JourneyStage.RETURN_ADVOCATE
    assert result.stage_status == StageStatus.COMPLETED


def test_last_meaningful_event_tracks_most_recent_progress_event():
    result = evaluate_journey_state(
        [
            _event("signup_completed"),
            _event("meaningful_action_completed", action_type="save"),
        ]
    )
    assert result.last_meaningful_event == "meaningful_action_completed"
    assert result.last_meaningful_event_at == T0
