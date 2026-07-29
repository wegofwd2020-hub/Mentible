import os
import uuid

import asyncpg
import pytest

from src.trust import artifact_repo, project_repo

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
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    return p


async def test_create_artifact_validates_enums(conn):
    p = await _project(conn)
    art = await artifact_repo.create_artifact(
        conn, project_id=p.id, role="cornerstone", format="book", title="Guide"
    )
    assert art.role == "cornerstone" and art.format == "book"
    with pytest.raises(ValueError):
        await artifact_repo.create_artifact(conn, project_id=p.id, role="bogus", format="book")
    with pytest.raises(ValueError):
        await artifact_repo.create_artifact(
            conn, project_id=p.id, role="derivative", format="bogus"
        )


async def test_versions_monotonic_and_sources(conn):
    p = await _project(conn)
    art = await artifact_repo.create_artifact(
        conn, project_id=p.id, role="derivative", format="linkedin"
    )
    v1 = await artifact_repo.create_version(
        conn, artifact_id=art.id, content={"text": "a"}, created_by_sub="op"
    )
    v2 = await artifact_repo.create_version(
        conn, artifact_id=art.id, content={"text": "b"}, created_by_sub="op"
    )
    assert (v1.version_no, v2.version_no) == (1, 2)
    assert v1.content == {"text": "a"}
    i = await project_repo.add_input(conn, project_id=p.id, kind="note", content="src")
    await artifact_repo.add_version_sources(conn, version_id=v1.id, input_ids=[i.id])
    assert await artifact_repo.list_version_sources(conn, version_id=v1.id) == [str(i.id)]


async def test_no_update_delete_api(conn):
    assert not hasattr(artifact_repo, "update_version")
    assert not hasattr(artifact_repo, "delete_version")
