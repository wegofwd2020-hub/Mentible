import os
import uuid

import asyncpg
import pytest

from src.trust import project_repo, topic_feedback_repo, topic_repo

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


async def _topic_version(conn):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    return await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=[],
        content={"sections": []},
        created_by_sub="op",
    )


async def test_add_and_list(conn):
    tv = await _topic_version(conn)
    f = await topic_feedback_repo.add_topic_feedback(
        conn,
        topic_version_id=tv.id,
        author_kind="expert",
        author_name="Dr X",
        body="tighten intro",
        recorded_by_sub="op",
    )
    assert f.author_kind == "expert" and f.author_name == "Dr X"
    assert [
        x.id for x in await topic_feedback_repo.list_topic_feedback(conn, topic_version_id=tv.id)
    ] == [f.id]


async def test_list_is_ordered_by_seq(conn):
    tv = await _topic_version(conn)
    f1 = await topic_feedback_repo.add_topic_feedback(
        conn, topic_version_id=tv.id, author_kind="expert", body="first", recorded_by_sub="op"
    )
    f2 = await topic_feedback_repo.add_topic_feedback(
        conn, topic_version_id=tv.id, author_kind="operator", body="second", recorded_by_sub="op"
    )
    assert [
        x.id for x in await topic_feedback_repo.list_topic_feedback(conn, topic_version_id=tv.id)
    ] == [f1.id, f2.id]


async def test_author_kind_validated(conn):
    tv = await _topic_version(conn)
    with pytest.raises(ValueError):
        await topic_feedback_repo.add_topic_feedback(
            conn, topic_version_id=tv.id, author_kind="bogus", body="x", recorded_by_sub="op"
        )
