import os
import uuid

import asyncpg
import pytest

from src.trust.access import ProjectAccessError, require_project_access

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not DSN, reason="DATABASE_URL not set"),
]


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


async def _make_account(conn) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id",
        f"sub-{uuid.uuid4()}",
    )


async def _make_project(conn, owner) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO project (owner_account_id, title) VALUES ($1,$2) RETURNING id",
        owner,
        "P",
    )


async def test_owner_gets_owner_role(conn):
    acc = await _make_account(conn)
    proj = await _make_project(conn, acc)
    role = await require_project_access(conn, account_id=acc, project_id=proj)
    assert role == "owner"


async def test_other_account_denied(conn):
    owner = await _make_account(conn)
    other = await _make_account(conn)
    proj = await _make_project(conn, owner)
    with pytest.raises(ProjectAccessError):
        await require_project_access(conn, account_id=other, project_id=proj)


async def test_missing_project_denied(conn):
    acc = await _make_account(conn)
    with pytest.raises(ProjectAccessError):
        await require_project_access(conn, account_id=acc, project_id=uuid.uuid4())
