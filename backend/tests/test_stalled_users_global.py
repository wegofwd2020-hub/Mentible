"""Global stalled-users dashboard reads user-level journey_state (regression: showed 0 on prod)."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from backend.src.analytics.dashboards import get_global_stalled_users


class _FakeConn:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    async def fetch(self, sql, *args):
        self.queries.append(sql)
        return self.rows


async def test_global_stalled_users_reads_user_level_journey_state():
    stalled_at = datetime.now(UTC) - timedelta(days=27)
    row = {
        "user_id": str(uuid4()),
        "email": "stuck@example.com",
        "project_id": None,
        "project_name": None,
        "journey_stage": "discover_join",
        "stalled_at": stalled_at.isoformat(),
        "days_stalled": 27,
        "intervention_attempt_count": 0,
        "last_intervention_sent_at": None,
    }
    conn = _FakeConn([row])

    result = await get_global_stalled_users(conn)

    assert len(conn.queries) == 1
    assert "FROM journey_state" in conn.queries[0]
    assert "project_journey_state" not in conn.queries[0]
    assert len(result) == 1
    assert result[0].email == "stuck@example.com"
    assert result[0].project_id is None
    assert result[0].days_stalled == 27


async def test_global_stalled_users_empty_when_none_stalled():
    conn = _FakeConn([])

    assert await get_global_stalled_users(conn) == []
