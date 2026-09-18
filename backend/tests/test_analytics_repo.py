import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

from backend.src.analytics import repo
from backend.src.analytics.schemas import EventIn

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


@pytest_asyncio.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    try:
        yield c
    finally:
        await c.execute("DELETE FROM analytics_event")
        await c.execute("DELETE FROM journey_state")
        await c.close()


@pytest_asyncio.fixture
async def account_id(conn):
    row = await conn.fetchrow(
        "INSERT INTO account (idp_sub, email) VALUES ($1, $2) RETURNING id",
        f"sub-{uuid.uuid4()}",
        "test@example.com",
    )
    yield row["id"]
    await conn.execute("DELETE FROM account WHERE id = $1", row["id"])


@pytest.mark.asyncio
async def test_record_event_inserts_row(conn, account_id):
    ev = EventIn(event_name="signup_completed", session_id="s-1", device_class="desktop")
    await repo.record_event(conn, event=ev, user_id=account_id)
    row = await conn.fetchrow("SELECT * FROM analytics_event WHERE event_id = $1", ev.event_id)
    assert row is not None
    assert row["event_name"] == "signup_completed"
    assert row["user_id"] == account_id


@pytest.mark.asyncio
async def test_record_event_allows_null_user_id_for_anonymous(conn):
    ev = EventIn(
        event_name="sample_viewed",
        session_id="s-2",
        anonymous_id="anon-1",
        device_class="mobile",
    )
    await repo.record_event(conn, event=ev, user_id=None)
    row = await conn.fetchrow("SELECT * FROM analytics_event WHERE event_id = $1", ev.event_id)
    assert row["user_id"] is None
    assert row["anonymous_id"] == "anon-1"


@pytest.mark.asyncio
async def test_get_journey_state_returns_none_when_absent(conn, account_id):
    assert await repo.get_journey_state(conn, account_id) is None


@pytest.mark.asyncio
async def test_merge_anonymous_into_user_backfills_user_id(conn, account_id):
    ev = EventIn(
        event_name="sample_viewed",
        session_id="s-3",
        anonymous_id="anon-merge-me",
        device_class="desktop",
    )
    await repo.record_event(conn, event=ev, user_id=None)
    updated = await repo.merge_anonymous_into_user(
        conn, anonymous_id="anon-merge-me", user_id=account_id
    )
    assert updated == 1
    row = await conn.fetchrow("SELECT user_id FROM analytics_event WHERE event_id = $1", ev.event_id)
    assert row["user_id"] == account_id


@pytest.mark.asyncio
async def test_merge_anonymous_into_user_is_idempotent(conn, account_id):
    updated = await repo.merge_anonymous_into_user(
        conn, anonymous_id="anon-never-seen", user_id=account_id
    )
    assert updated == 0
