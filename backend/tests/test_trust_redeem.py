import os
import uuid

import asyncpg
import pytest

from src.trust import membership_repo, project_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction()
    await tx.start()
    try:
        yield c
    finally:
        await tx.rollback()
        await c.close()


async def _account(conn, email=None):
    return await conn.fetchval(
        "INSERT INTO account (idp_sub, email) VALUES ($1,$2) RETURNING id",
        f"s-{uuid.uuid4()}",
        email,
    )


async def _project(conn):
    owner = await _account(conn)
    return await project_repo.create_project(conn, owner_account_id=owner, title="T")


async def test_redeem_creates_membership(conn):
    p = await _project(conn)
    await membership_repo.invite(
        conn, project_id=p.id, email="expert@firm.com", invited_by_sub="op"
    )
    expert = await _account(conn, email="expert@firm.com")
    got = await membership_repo.redeem_invitations_for(
        conn, account_id=expert, email="Expert@Firm.com"
    )
    assert [(m.project_id, m.role) for m in got] == [(p.id, "reviewer")]
    # idempotent on second login
    again = await membership_repo.redeem_invitations_for(
        conn, account_id=expert, email="expert@firm.com"
    )
    assert [(m.project_id, m.role) for m in again] == [(p.id, "reviewer")]


async def test_redeem_skips_revoked_and_unrelated(conn):
    p = await _project(conn)
    await membership_repo.invite(
        conn, project_id=p.id, email="expert@firm.com", invited_by_sub="op"
    )
    await membership_repo.revoke(conn, project_id=p.id, email="expert@firm.com")
    expert = await _account(conn)
    assert (
        await membership_repo.redeem_invitations_for(
            conn, account_id=expert, email="expert@firm.com"
        )
        == []
    )
    assert (
        await membership_repo.redeem_invitations_for(conn, account_id=expert, email="nobody@x.z")
        == []
    )
