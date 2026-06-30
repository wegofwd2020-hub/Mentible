"""usage_event repo (ADR-005 D6, Phase 2) against a real Postgres.

Each test runs in a rolled-back transaction, like test_accounts_repo. Skipped when
DATABASE_URL is unset (local runs without a DB, and the non-DB CI jobs).
"""

from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from backend.src.accounts import repo as accounts_repo
from backend.src.billing import usage_repo

DSN = os.environ.get("DATABASE_URL", "")

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)"),
]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tr = c.transaction()
    await tr.start()
    try:
        yield c
    finally:
        await tr.rollback()
        await c.close()


async def _account(conn, sub: str = "usage-sub"):
    return await accounts_repo.get_or_create_account(conn, idp_sub=sub, email=None)


async def _record(conn, account_id, **over):
    kw = {
        "account_id": account_id,
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "input_tokens": 100,
        "output_tokens": 500,
        "cost_micros": 7800,
        "job_id": uuid.uuid4(),
    }
    kw.update(over)
    await usage_repo.record_usage(conn, **kw)


async def test_record_then_period_sums(conn):
    from datetime import UTC, datetime, timedelta

    acct = await _account(conn)
    await _record(conn, acct.id)
    await _record(conn, acct.id, input_tokens=50, output_tokens=50, cost_micros=1000)

    since = datetime.now(UTC) - timedelta(days=30)
    usage = await usage_repo.period_usage(conn, account_id=acct.id, since=since)
    assert usage.events == 2
    assert usage.input_tokens == 150
    assert usage.output_tokens == 550
    assert usage.cost_micros == 8800


async def test_period_zero_when_no_events(conn):
    from datetime import UTC, datetime, timedelta

    acct = await _account(conn, sub="empty-sub")
    since = datetime.now(UTC) - timedelta(days=30)
    usage = await usage_repo.period_usage(conn, account_id=acct.id, since=since)
    assert usage == usage_repo.PeriodUsage(0, 0, 0, 0)


async def test_period_window_excludes_old_events(conn):
    """Events before the window start are not counted."""
    from datetime import UTC, datetime, timedelta

    acct = await _account(conn, sub="window-sub")
    await _record(conn, acct.id)
    # A window that starts in the future excludes the just-written row.
    future = datetime.now(UTC) + timedelta(days=1)
    usage = await usage_repo.period_usage(conn, account_id=acct.id, since=future)
    assert usage.events == 0


async def test_total_usage_aggregates_all_accounts(conn):
    from datetime import UTC, datetime, timedelta

    a = await _account(conn, sub="tot-a")
    b = await _account(conn, sub="tot-b")
    await _record(conn, a.id)  # 7800
    await _record(conn, b.id, cost_micros=1_000)
    since = datetime.now(UTC) - timedelta(days=30)
    total = await usage_repo.total_usage(conn, since=since)
    assert total.accounts >= 2
    assert total.events >= 2
    assert total.cost_micros >= 8_800


async def test_usage_isolated_per_account(conn):
    a = await _account(conn, sub="acct-a")
    b = await _account(conn, sub="acct-b")
    await _record(conn, a.id)
    from datetime import UTC, datetime, timedelta

    since = datetime.now(UTC) - timedelta(days=30)
    assert (await usage_repo.period_usage(conn, account_id=a.id, since=since)).events == 1
    assert (await usage_repo.period_usage(conn, account_id=b.id, since=since)).events == 0
