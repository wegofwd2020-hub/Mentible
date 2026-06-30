"""entitlement repo (ADR-005 D6, Phase 3) against a real Postgres.

Rolled-back transaction per test, like test_accounts_repo. Skipped without DATABASE_URL.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from backend.src.accounts import repo as accounts_repo
from backend.src.billing import entitlement_repo

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


async def _account(conn, sub="ent-sub"):
    return await accounts_repo.get_or_create_account(conn, idp_sub=sub, email=None)


async def _set(conn, account_id, plan_id="managed_basic", status="active"):
    now = datetime.now(UTC)
    return await entitlement_repo.set_entitlement(
        conn,
        account_id=account_id,
        plan_id=plan_id,
        status=status,
        period_start=now,
        period_end=now + timedelta(days=30),
    )


async def test_set_then_get(conn):
    acct = await _account(conn)
    written = await _set(conn, acct.id)
    got = await entitlement_repo.get_entitlement(conn, account_id=acct.id)
    assert got == written
    assert got.plan_id == "managed_basic"
    assert got.status == "active"


async def test_upsert_replaces_in_place(conn):
    acct = await _account(conn, sub="ent-upsert")
    await _set(conn, acct.id, plan_id="managed_basic")
    await _set(conn, acct.id, plan_id="managed_unlimited", status="canceled")
    got = await entitlement_repo.get_entitlement(conn, account_id=acct.id)
    assert got.plan_id == "managed_unlimited"
    assert got.status == "canceled"


async def test_get_none_when_unset(conn):
    acct = await _account(conn, sub="ent-none")
    assert await entitlement_repo.get_entitlement(conn, account_id=acct.id) is None


async def test_invalid_status_rejected(conn):
    acct = await _account(conn, sub="ent-bad")
    with pytest.raises(ValueError):
        await _set(conn, acct.id, status="bogus")


async def test_set_status_updates_keeping_plan_and_period(conn):
    acct = await _account(conn, sub="ent-status")
    written = await _set(conn, acct.id, plan_id="managed_basic")
    updated = await entitlement_repo.set_status(conn, account_id=acct.id, status="canceled")
    assert updated.status == "canceled"
    # plan + period are unchanged.
    assert updated.plan_id == "managed_basic"
    assert updated.period_start == written.period_start
    assert updated.period_end == written.period_end


async def test_set_status_no_entitlement_returns_none(conn):
    acct = await _account(conn, sub="ent-status-none")
    assert await entitlement_repo.set_status(conn, account_id=acct.id, status="past_due") is None
