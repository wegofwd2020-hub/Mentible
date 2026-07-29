import os
import uuid

import asyncpg
import pytest

from src.trust.access import (
    ProjectAccessError,
    project_id_for_artifact,
    project_id_for_version,
    require_project_access,
)

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


async def _make_artifact_version(conn, project_id):
    art = await conn.fetchval(
        "INSERT INTO artifact (project_id, role, format) VALUES ($1,'derivative','linkedin') RETURNING id",
        project_id,
    )
    ver = await conn.fetchval(
        "INSERT INTO artifact_version (artifact_id, version_no, content, created_by_sub) "
        "VALUES ($1, 1, '{}'::jsonb, 'op') RETURNING id",
        art,
    )
    return art, ver


async def test_reviewer_member_gets_role(conn):
    owner = await _make_account(conn)
    reviewer = await _make_account(conn)
    proj = await _make_project(conn, owner)
    await conn.execute(
        "INSERT INTO project_membership (project_id, account_id, role) VALUES ($1,$2,'reviewer')",
        proj,
        reviewer,
    )
    assert await require_project_access(conn, account_id=reviewer, project_id=proj) == "reviewer"


async def test_non_member_still_denied(conn):
    owner = await _make_account(conn)
    stranger = await _make_account(conn)
    proj = await _make_project(conn, owner)
    with pytest.raises(ProjectAccessError):
        await require_project_access(conn, account_id=stranger, project_id=proj)


async def test_project_id_resolvers(conn):
    owner = await _make_account(conn)
    proj = await _make_project(conn, owner)
    art, ver = await _make_artifact_version(conn, proj)
    assert await project_id_for_artifact(conn, artifact_id=art) == proj
    assert await project_id_for_version(conn, version_id=ver) == proj
    assert await project_id_for_version(conn, version_id=uuid.uuid4()) is None
