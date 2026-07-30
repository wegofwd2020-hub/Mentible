import os
import uuid
from datetime import UTC, datetime

import asyncpg
import pytest

from src.trust import approval_repo, artifact_repo, project_repo

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


async def test_validation_flips_only_after_approval(conn):
    v = await _version(conn)
    assert await approval_repo.is_validated(conn, version_id=v.id) is False
    ap = await approval_repo.record_approval(
        conn,
        version_id=v.id,
        expert_name="Dr X",
        approved_at=datetime.now(UTC),
        recorded_by_sub="op",
        expert_role="civil engineer",
        note="approved",
    )
    assert ap.expert_name == "Dr X"
    assert await approval_repo.is_validated(conn, version_id=v.id) is True
    assert (await approval_repo.get_approval(conn, version_id=v.id)).id == ap.id


async def test_append_only_no_mutators(conn):
    assert not hasattr(approval_repo, "update_approval")
    assert not hasattr(approval_repo, "delete_approval")


async def test_recorded_via_default_and_expert_self(conn):
    v = await _version(conn)
    a1 = await approval_repo.record_approval(
        conn,
        version_id=v.id,
        expert_name="Dr X",
        approved_at=datetime.now(UTC),
        recorded_by_sub="op",
    )
    assert a1.recorded_via == "operator"
    v2 = await _version(conn)
    a2 = await approval_repo.record_approval(
        conn,
        version_id=v2.id,
        expert_name="Dr Y",
        approved_at=datetime.now(UTC),
        recorded_by_sub="expert-sub",
        recorded_via="expert_self",
    )
    assert a2.recorded_via == "expert_self"
    assert (await approval_repo.get_approval(conn, version_id=v2.id)).recorded_via == "expert_self"


async def test_recorded_via_invalid(conn):
    v = await _version(conn)
    with pytest.raises(ValueError):
        await approval_repo.record_approval(
            conn,
            version_id=v.id,
            expert_name="Z",
            approved_at=datetime.now(UTC),
            recorded_by_sub="op",
            recorded_via="bogus",
        )
