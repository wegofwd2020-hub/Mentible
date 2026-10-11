"""max_intervention_attempts is enforced by send-stalled (single-user and bulk paths)."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.src.admin import intervention_config
from backend.src.analytics import router as analytics_router
from backend.src.analytics.intervention import InterventionService


class _FakeConn:
    """Records bulk fetch calls; returns the stalled-user rows it was given."""

    def __init__(self, rows=None):
        self.rows = rows or []
        self.fetch_calls = []

    async def fetch(self, sql, *args):
        self.fetch_calls.append((sql, args))
        return self.rows


def _journey(attempts: int) -> dict:
    return {
        "stalled_at": datetime.now(UTC) - timedelta(days=30),
        "stall_reason": "no_progress",
        "current_journey_stage": "outline",
        "stage_status": "stalled",
        "last_meaningful_event": None,
        "last_meaningful_event_at": None,
        "intervention_status": "in_progress",
        "intervention_sent_at": datetime.now(UTC) - timedelta(days=30),
        "intervention_attempt_count": attempts,
    }


@pytest.fixture
def sent_calls(monkeypatch):
    calls = []

    async def fake_send(conn, user_id, email, stall_reason, journey, app_url=None):
        calls.append(user_id)
        return True

    monkeypatch.setattr(InterventionService, "send_intervention_for_user", staticmethod(fake_send))
    return calls


@pytest.fixture
def max_attempts(monkeypatch):
    monkeypatch.setattr(
        intervention_config,
        "_cache",
        {"intervention_retry_interval_days": 7, "max_intervention_attempts": 3},
    )
    return 3


def _account(email="learner@example.com"):
    class _Account:
        pass

    acct = _Account()
    acct.email = email
    return acct


async def test_single_user_at_cap_is_refused(monkeypatch, sent_calls, max_attempts):
    async def fake_journey(conn, user_id):
        return _journey(attempts=3)

    async def fake_account(conn, user_id):
        return _account()

    monkeypatch.setattr(analytics_router, "get_journey_state", fake_journey)
    monkeypatch.setattr(analytics_router.accounts_repo, "get_account", fake_account)

    body = analytics_router.SendInterventionsRequest(user_id=uuid4())
    with pytest.raises(HTTPException) as exc:
        await analytics_router.send_interventions(body, principal=None, conn=_FakeConn())

    assert exc.value.status_code == 400
    assert "Attempt cap reached" in exc.value.detail
    assert sent_calls == []


async def test_single_user_below_cap_is_sent(monkeypatch, sent_calls, max_attempts):
    async def fake_journey(conn, user_id):
        return _journey(attempts=2)

    async def fake_account(conn, user_id):
        return _account()

    monkeypatch.setattr(analytics_router, "get_journey_state", fake_journey)
    monkeypatch.setattr(analytics_router.accounts_repo, "get_account", fake_account)

    body = analytics_router.SendInterventionsRequest(user_id=uuid4())
    resp = await analytics_router.send_interventions(body, principal=None, conn=_FakeConn())

    assert resp.sent_count == 1
    assert len(sent_calls) == 1


async def test_bulk_query_passes_cap_as_bound_parameter(monkeypatch, sent_calls, max_attempts):
    conn = _FakeConn(rows=[])

    await analytics_router.send_interventions(
        analytics_router.SendInterventionsRequest(), principal=None, conn=conn
    )

    assert len(conn.fetch_calls) == 1
    sql, args = conn.fetch_calls[0]
    assert "j.intervention_attempt_count < $2" in sql
    assert "* $1" in sql
    assert args == (7, max_attempts)  # default retry interval, then the cap
    assert "%s" not in sql
