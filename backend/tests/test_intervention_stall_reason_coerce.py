"""Stored stall reasons (plain, possibly uppercase strings) must work on the send path."""

from uuid import uuid4

import pytest

from backend.src.analytics import intervention as intervention_mod
from backend.src.analytics.intervention import InterventionService, coerce_stall_reason
from backend.src.analytics.models import StallReason


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("no_meaningful_action", StallReason.NO_MEANINGFUL_ACTION),
        ("NO_MEANINGFUL_ACTION", StallReason.NO_MEANINGFUL_ACTION),
        (StallReason.INACTIVE, StallReason.INACTIVE),
        ("not_a_reason", StallReason.UNKNOWN),
        (None, StallReason.UNKNOWN),
    ],
)
def test_coerce_stall_reason(raw, expected):
    assert coerce_stall_reason(raw) is expected


class _FakeResponse:
    status_code = 401
    text = "rejected"


class _FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        return _FakeResponse()


async def test_send_with_string_stall_reason_does_not_raise(monkeypatch):
    """Regression: 'str' object has no attribute 'value' on the event-emit step."""
    emitted = []

    async def fake_record_event(conn, event, user_id):
        emitted.append(event.properties)

    monkeypatch.setattr(intervention_mod, "record_event", fake_record_event)
    monkeypatch.setattr(intervention_mod.httpx, "AsyncClient", _FakeClient)

    sent = await InterventionService.send_intervention_for_user(
        conn=object(),
        user_id=uuid4(),
        email="someone@example.com",
        stall_reason="NO_MEANINGFUL_ACTION",
        journey_state_dict={
            "current_journey_stage": "discover_join",
            "stage_status": "not_started",
        },
    )

    assert sent is False  # provider rejected the token
    assert emitted and emitted[0]["stall_reason"] == "no_meaningful_action"
