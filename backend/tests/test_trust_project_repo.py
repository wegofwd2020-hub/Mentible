import os
import uuid

import asyncpg
import pytest

from src.trust import project_repo

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


async def _account(conn):
    return await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )


async def test_create_and_list_scoped(conn):
    a1 = await _account(conn)
    a2 = await _account(conn)
    p = await project_repo.create_project(conn, owner_account_id=a1, title="Stormwater")
    assert p.title == "Stormwater" and p.status == "active"
    assert [x.id for x in await project_repo.list_projects(conn, owner_account_id=a1)] == [p.id]
    assert await project_repo.list_projects(conn, owner_account_id=a2) == []


async def test_set_status_validates(conn):
    a = await _account(conn)
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    await project_repo.set_status(conn, project_id=p.id, status="archived")
    assert (await project_repo.get_project(conn, project_id=p.id)).status == "archived"
    with pytest.raises(ValueError):
        await project_repo.set_status(conn, project_id=p.id, status="bogus")


async def test_add_and_list_inputs(conn):
    a = await _account(conn)
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    i = await project_repo.add_input(
        conn, project_id=p.id, kind="transcript", title="Interview 1", content="hello"
    )
    assert i.kind == "transcript" and i.content == "hello"
    assert [x.id for x in await project_repo.list_inputs(conn, project_id=p.id)] == [i.id]
    with pytest.raises(ValueError):
        await project_repo.add_input(conn, project_id=p.id, kind="bogus", content="x")
