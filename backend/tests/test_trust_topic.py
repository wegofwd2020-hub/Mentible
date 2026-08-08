import os
import uuid
from datetime import UTC, datetime

import asyncpg
import pytest

from src.trust import project_repo, topic_approval_repo, topic_repo

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


async def test_topic_version_and_approval_roundtrip(conn):
    p = await _project(conn)
    tv = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=["s1"],
        content={"sections": [{"heading": "Staff", "body": "…", "source_ids": ["s1"]}]},
        created_by_sub="sub-1",
    )
    assert tv.version_no == 1
    assert tv.title == "Reading music"
    assert tv.source_ids == ["s1"]
    assert tv.content["sections"][0]["heading"] == "Staff"
    assert await topic_repo.get_topic_version(conn, topic_version_id=tv.id) == tv
    assert await topic_repo.project_id_for_topic_version(conn, topic_version_id=tv.id) == p.id

    assert not await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)
    await topic_approval_repo.record_topic_approval(
        conn,
        topic_version_id=tv.id,
        expert_name="Dr X",
        approved_at=datetime.now(UTC),
        recorded_by_sub="sub-1",
        expert_email=None,
        expert_role=None,
        note=None,
        recorded_via="operator",
    )
    assert await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)

    # a second version for the same topic increments version_no
    tv2 = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=["s1"],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    assert tv2.version_no == 2
    # a fresh topic in the same project starts back at 1
    tv3 = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t2",
        title="Dynamics",
        source_ids=[],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    assert tv3.version_no == 1

    versions = await topic_repo.list_topic_versions(conn, project_id=p.id)
    assert {v.id for v in versions} == {tv.id, tv2.id, tv3.id}


async def test_withdraw_topic_approval_is_noop_when_not_approved(conn):
    p = await _project(conn)
    tv = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=[],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    assert (
        await topic_approval_repo.withdraw_topic_approval(
            conn, topic_version_id=tv.id, recorded_by_sub="sub-1"
        )
        is None
    )
    await topic_approval_repo.record_topic_approval(
        conn,
        topic_version_id=tv.id,
        expert_name="Dr X",
        approved_at=datetime.now(UTC),
        recorded_by_sub="sub-1",
    )
    wd = await topic_approval_repo.withdraw_topic_approval(
        conn, topic_version_id=tv.id, recorded_by_sub="sub-1"
    )
    assert wd is not None
    assert wd.action == "withdraw"
    assert not await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)
    # withdrawing an already-withdrawn version is a no-op
    assert (
        await topic_approval_repo.withdraw_topic_approval(
            conn, topic_version_id=tv.id, recorded_by_sub="sub-1"
        )
        is None
    )


async def test_record_topic_approval_invalid_enums(conn):
    p = await _project(conn)
    tv = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=[],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    with pytest.raises(ValueError):
        await topic_approval_repo.record_topic_approval(
            conn,
            topic_version_id=tv.id,
            expert_name="Dr X",
            approved_at=datetime.now(UTC),
            recorded_by_sub="sub-1",
            recorded_via="bogus",
        )
