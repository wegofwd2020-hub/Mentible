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


async def _project(conn):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    return await project_repo.create_project(conn, owner_account_id=a, title="T")


async def test_invite_lowercases_and_reactivates(conn):
    p = await _project(conn)
    inv = await membership_repo.invite(
        conn, project_id=p.id, email="Expert@Firm.COM", invited_by_sub="op"
    )
    assert (
        inv.invited_email == "expert@firm.com" and inv.role == "reviewer" and inv.revoked_at is None
    )
    await membership_repo.revoke(conn, project_id=p.id, email="expert@firm.com")
    assert (await membership_repo.list_invitations(conn, project_id=p.id))[0].revoked_at is not None
    # re-invite reactivates the same row (unique project_id+email)
    inv2 = await membership_repo.invite(
        conn, project_id=p.id, email="expert@firm.com", invited_by_sub="op2"
    )
    assert inv2.revoked_at is None
    assert len(await membership_repo.list_invitations(conn, project_id=p.id)) == 1


async def test_invite_bad_role(conn):
    p = await _project(conn)
    with pytest.raises(ValueError):
        await membership_repo.invite(
            conn, project_id=p.id, email="x@y.z", invited_by_sub="op", role="owner"
        )


async def test_list_members(conn):
    p = await _project(conn)
    acc = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    await conn.execute(
        "INSERT INTO project_membership (project_id, account_id, role) VALUES ($1,$2,'reviewer')",
        p.id,
        acc,
    )
    members = await membership_repo.list_members(conn, project_id=p.id)
    assert [m.account_id for m in members] == [acc] and members[0].role == "reviewer"
