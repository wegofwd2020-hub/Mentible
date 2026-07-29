import os
import uuid

import asyncpg
import pytest

from src.trust import artifact_repo, feedback_repo, project_repo

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


async def _version(conn):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    art = await artifact_repo.create_artifact(
        conn, project_id=p.id, role="cornerstone", format="book"
    )
    return await artifact_repo.create_version(
        conn, artifact_id=art.id, content={}, created_by_sub="op"
    )


async def test_add_and_list(conn):
    v = await _version(conn)
    f = await feedback_repo.add_feedback(
        conn,
        version_id=v.id,
        author_kind="expert",
        author_name="Dr X",
        body="tighten intro",
        recorded_by_sub="op",
    )
    assert f.author_kind == "expert" and f.author_name == "Dr X"
    assert [x.id for x in await feedback_repo.list_feedback(conn, version_id=v.id)] == [f.id]


async def test_author_kind_validated(conn):
    v = await _version(conn)
    with pytest.raises(ValueError):
        await feedback_repo.add_feedback(
            conn, version_id=v.id, author_kind="bogus", body="x", recorded_by_sub="op"
        )
