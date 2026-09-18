"""Analytics ingestion endpoint: POST /api/v1/analytics/events."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.accounts.models import Account
from backend.src.analytics.models import DeviceClass, EventName, JourneyStage
from backend.src.analytics.schemas import EventIn, PrivacyViolation
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn


class _MockAccount:
    """Minimal Account-like object for testing."""

    def __init__(self, account_id: str = "11111111-1111-1111-1111-111111111111"):
        self.id = uuid.UUID(account_id)


class _Conn:
    """Mock asyncpg.Connection for analytics tests."""

    def __init__(self, return_events: list[dict] | None = None):
        self.executed = []
        self.return_events = return_events or []
        self.inserted_events: list[dict] = []  # Track newly inserted events
        self._account = _MockAccount()

    async def execute(self, sql, *args):
        """Track execute calls (INSERT/UPDATE)."""
        self.executed.append(("execute", sql, args))

        # Simulate INSERT INTO analytics_event by tracking the inserted event
        if "INSERT INTO analytics_event" in sql:
            # Args are: event_id, event_name, occurred_at, anonymous_id, user_id, session_id,
            # project_id, journey_stage, use_case, content_type, plan_id,
            # acquisition_source, device_class, experiment_variant, success,
            # error_code, duration_ms, properties (as JSON string from repo layer)
            # Parse properties JSON back to dict since asyncpg would auto-deserialize JSONB
            properties_json = args[17]
            properties = (
                json.loads(properties_json) if isinstance(properties_json, str) else properties_json
            )

            self.inserted_events.append(
                {
                    "event_id": args[0],
                    "event_name": args[1],
                    "occurred_at": args[2],
                    "anonymous_id": args[3],
                    "user_id": args[4],
                    "session_id": args[5],
                    "project_id": args[6],
                    "journey_stage": args[7],
                    "use_case": args[8],
                    "content_type": args[9],
                    "plan_id": args[10],
                    "acquisition_source": args[11],
                    "device_class": args[12],
                    "experiment_variant": args[13],
                    "success": args[14],
                    "error_code": args[15],
                    "duration_ms": args[16],
                    "properties": properties,
                }
            )

    async def fetchrow(self, sql, *args):
        """Support get_or_create_account (INSERT ... RETURNING) and journey state reads."""
        self.executed.append(("fetchrow", sql, args))

        # For get_or_create_account
        if "INSERT INTO account" in sql:
            return {
                "id": self._account.id,
                "idp_sub": args[0] if args else "test-sub",
                "email": args[1] if len(args) > 1 else None,
                "created_at": datetime.now(UTC),
                "synced_library_ref": None,
                "suspended": False,
                "suspended_at": None,
            }

        # For get_journey_state (if needed)
        if "SELECT * FROM journey_state" in sql:
            return None  # No prior state → all-new user

        return None

    async def fetch(self, sql, *args):
        """Support get_events_for_user (SELECT with ORDER BY)."""
        self.executed.append(("fetch", sql, args))

        # For get_events_for_user: return the pre-seeded event history plus any newly inserted events
        if "SELECT * FROM analytics_event WHERE user_id" in sql:
            # Combine prior events with newly inserted events
            return self.return_events + self.inserted_events

        return []


class _Pool:
    """Minimal pool that yields a _Conn."""

    def __init__(self, conn: _Conn):
        self._conn = conn

    def acquire(self):
        conn = self._conn

        class _Cm:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *a):
                pass

        return _Cm()


@pytest.fixture
def as_user():
    """Fixture to set up a logged-in user and mock db connection."""

    def _setup(
        sub: str = "test-user-123",
        email: str = "test@example.com",
        conn: _Conn | None = None,
    ):
        app.dependency_overrides[require_active_user] = lambda: Principal(
            sub=sub, email=email, issuer="test"
        )
        app.dependency_overrides[get_conn] = lambda: conn or _Conn()
        app.state.db = _Pool(conn or _Conn())

    yield _setup
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_post_event_accepts_valid_payload(as_user):
    """POST /api/v1/analytics/events with valid payload returns 201 and event_id."""
    from httpx import ASGITransport, AsyncClient

    conn = _Conn()
    as_user(sub="user-1", email="user@example.com", conn=conn)

    event_id = str(uuid.uuid4())
    payload = {
        "event_id": event_id,
        "event_name": EventName.SIGNUP_COMPLETED.value,
        "session_id": "session-1",
        "device_class": DeviceClass.MOBILE.value,
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/analytics/events", json=payload)

    assert r.status_code == 201
    data = r.json()
    assert data["event_id"] == event_id

    # Verify execute was called (record_event and upsert_journey_state)
    execute_calls = [call for call in conn.executed if call[0] == "execute"]
    assert len(execute_calls) >= 2  # insert analytics_event + upsert journey_state


@pytest.mark.asyncio
async def test_post_event_rejects_sensitive_properties(as_user):
    """POST /api/v1/analytics/events with sensitive properties returns 422."""
    from httpx import ASGITransport, AsyncClient

    conn = _Conn()
    as_user(sub="user-1", email="user@example.com", conn=conn)

    # Event with forbidden key fragment
    payload = {
        "event_id": str(uuid.uuid4()),
        "event_name": EventName.SIGNUP_COMPLETED.value,
        "session_id": "session-1",
        "device_class": DeviceClass.MOBILE.value,
        "properties": {
            "reviewer_comment": "This is a comment",  # Forbidden key fragment
        },
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/analytics/events", json=payload)

    assert r.status_code == 422
    data = r.json()
    # Validation error should mention the privacy violation
    assert "detail" in data


@pytest.mark.asyncio
async def test_post_event_recomputes_journey_state(as_user):
    """POST /api/v1/analytics/events recomputes journey state from full history."""
    from httpx import ASGITransport, AsyncClient

    # Pre-seed a prior event history
    prior_events = [
        {
            "event_id": uuid.uuid4(),
            "event_name": EventName.SIGNUP_COMPLETED.value,
            "occurred_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
            "anonymous_id": None,
            "user_id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
            "session_id": "session-1",
            "project_id": None,
            "journey_stage": None,
            "use_case": None,
            "content_type": None,
            "plan_id": None,
            "acquisition_source": None,
            "device_class": DeviceClass.DESKTOP.value,
            "experiment_variant": None,
            "success": None,
            "error_code": None,
            "duration_ms": None,
            "properties": {},
        }
    ]

    conn = _Conn(return_events=prior_events)
    as_user(sub="user-1", email="user@example.com", conn=conn)

    # New event: a meaningful action that should advance the stage
    payload = {
        "event_id": str(uuid.uuid4()),
        "event_name": EventName.MEANINGFUL_ACTION_COMPLETED.value,
        "session_id": "session-1",
        "device_class": DeviceClass.MOBILE.value,
        "properties": {
            "action_type": "edit",  # Qualifying action
        },
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/analytics/events", json=payload)

    assert r.status_code == 201

    # Verify the journey state upsert was called
    upsert_calls = [
        call
        for call in conn.executed
        if call[0] == "execute" and "INSERT INTO journey_state" in call[1]
    ]
    assert len(upsert_calls) == 1  # One upsert per event post

    # The upsert call should have parameters including the advanced stage
    upsert_call = upsert_calls[0]
    # Arg order from upsert_journey_state: user_id, current_journey_stage, stage_status, ...
    args = upsert_call[2]
    # args[1] is current_journey_stage
    assert args[1] == JourneyStage.REFINE_VALIDATE.value
