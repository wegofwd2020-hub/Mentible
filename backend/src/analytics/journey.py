"""Pure journey-state evaluator. No DB dependency — rebuildable from full event history
(AC2/AC4). Stage-advancement rules come from the design doc's Journey Stage Requirements
table and the Primary Activation Decision (generation alone never activates)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from backend.src.analytics.models import JourneyStage, StageStatus, StallReason
from backend.src.analytics.stall import detect_stall

_QUALIFYING_ACTION_TYPES = {"edit", "save", "approve", "continue"}

# Events that count as "meaningful progress" for last_meaningful_event, in the
# order that advances current_journey_stage. Each entry's presence in history
# (with any extra per-event condition satisfied) unlocks the next stage.
_STAGE_ORDER = [
    JourneyStage.DISCOVER_JOIN,
    JourneyStage.CREATE_FIRST_VALUE,
    JourneyStage.REFINE_VALIDATE,
    JourneyStage.FINISH_PAY,
    JourneyStage.RETURN_ADVOCATE,
]


@dataclass(frozen=True)
class JourneyStateResult:
    current_journey_stage: JourneyStage
    stage_status: StageStatus
    last_meaningful_event: str | None
    last_meaningful_event_at: datetime | None
    stalled_at: datetime | None = None
    stall_reason: StallReason | None = None
    intervention_status: str | None = None
    resumed_at: datetime | None = None


def _is_meaningful_action(event: dict) -> bool:
    if event["event_name"] != "meaningful_action_completed":
        return False
    return event.get("properties", {}).get("action_type") in _QUALIFYING_ACTION_TYPES


def evaluate_journey_state(
    events: list[dict],
    thresholds: dict[str, int] | None = None,
    current_time: datetime | None = None,
) -> JourneyStateResult:
    """Evaluate user's journey stage and stall status.

    Args:
        events: List of event dicts with 'event_name' and 'occurred_at'.
        thresholds: Stall detection thresholds (stage -> days). If None, stall detection is skipped.
        current_time: Reference time for stall detection. Defaults to now.
    """
    from uuid import UUID

    if current_time is None:
        from datetime import UTC
        current_time = datetime.now(UTC)

    stage_index = 0  # discover_join
    status = StageStatus.NOT_STARTED
    last_meaningful_event: str | None = None
    last_meaningful_event_at: datetime | None = None

    for event in events:
        name = event["event_name"]

        if name == "signup_completed" and stage_index == 0:
            stage_index = 1  # create_first_value
            status = StageStatus.IN_PROGRESS
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

        elif _is_meaningful_action(event) and stage_index == 1:
            stage_index = 2  # refine_validate
            status = StageStatus.IN_PROGRESS
            last_meaningful_event = "meaningful_action_completed"
            last_meaningful_event_at = event["occurred_at"]

        elif name == "review_completed" and stage_index == 2:
            stage_index = 3  # finish_pay
            status = StageStatus.IN_PROGRESS
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

        elif name in ("export_completed", "publish_completed") and stage_index >= 2:
            stage_index = 4  # return_advocate
            status = StageStatus.IN_PROGRESS
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

        elif name == "second_project_created" and stage_index == 4:
            status = StageStatus.COMPLETED
            last_meaningful_event, last_meaningful_event_at = name, event["occurred_at"]

    # Detect stalls (sub-project 2)
    stalled_at = None
    stall_reason = None
    if thresholds is not None and status == StageStatus.IN_PROGRESS:
        result = detect_stall(
            user_id=UUID("00000000-0000-0000-0000-000000000000"),  # placeholder
            current_stage=str(_STAGE_ORDER[stage_index]),
            last_meaningful_event_at=last_meaningful_event_at,
            events_in_stage=events,
            current_time=current_time,
            thresholds=thresholds,
        )

        if result.is_stalled:
            stalled_at = current_time
            stall_reason = result.stall_reason
            status = StageStatus.STALLED

    return JourneyStateResult(
        current_journey_stage=_STAGE_ORDER[stage_index],
        stage_status=status,
        last_meaningful_event=last_meaningful_event,
        last_meaningful_event_at=last_meaningful_event_at,
        stalled_at=stalled_at,
        stall_reason=stall_reason,
    )
