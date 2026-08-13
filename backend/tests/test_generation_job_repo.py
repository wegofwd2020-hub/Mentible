import os
import uuid

import asyncpg
import pytest

from src.trust import generation_job_repo, project_repo

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
    return p.id


async def test_create_defaults(conn):
    project_id = await _project(conn)
    job = await generation_job_repo.create(
        conn, project_id=project_id, total=3, created_by_sub="op"
    )
    assert job.status == "queued"
    assert job.done == 0
    assert job.failed_topic_ids == []
    assert job.total == 3
    assert job.project_id == project_id


async def test_update_progress_done_and_status(conn):
    project_id = await _project(conn)
    job = await generation_job_repo.create(
        conn, project_id=project_id, total=3, created_by_sub="op"
    )
    await generation_job_repo.update_progress(conn, job_id=job.id, done=1, status="running")
    got = await generation_job_repo.get(conn, job_id=job.id)
    assert got.done == 1
    assert got.status == "running"


async def test_update_progress_total_rewrite(conn):
    # F3 (fix round, final review): `total` is frozen at submit time
    # (len(missing) as of the submit request); if the TOC changed before the
    # worker picked the job up, the worker's own `missing` count can differ
    # from that snapshot, skewing done/total. `_run_book` re-writes `total`
    # from its own `missing` right after it flips status to "running" — this
    # asserts the repo primitive that write relies on sets `total` in the
    # dynamic SET, the same pattern as `done`/`status`.
    project_id = await _project(conn)
    job = await generation_job_repo.create(
        conn, project_id=project_id, total=3, created_by_sub="op"
    )
    await generation_job_repo.update_progress(conn, job_id=job.id, status="running", total=8)
    got = await generation_job_repo.get(conn, job_id=job.id)
    assert got.total == 8
    assert got.status == "running"


async def test_update_progress_add_failed_topic_id_appends(conn):
    project_id = await _project(conn)
    job = await generation_job_repo.create(
        conn, project_id=project_id, total=3, created_by_sub="op"
    )
    await generation_job_repo.update_progress(conn, job_id=job.id, add_failed_topic_id="u1")
    await generation_job_repo.update_progress(conn, job_id=job.id, add_failed_topic_id="u2")
    got = await generation_job_repo.get(conn, job_id=job.id)
    assert got.failed_topic_ids == ["u1", "u2"]


async def test_get_missing_returns_none(conn):
    assert await generation_job_repo.get(conn, job_id=str(uuid.uuid4())) is None


async def test_latest_for_project_returns_newest(conn):
    project_id = await _project(conn)
    older = await generation_job_repo.create(
        conn, project_id=project_id, total=1, created_by_sub="op"
    )
    await conn.execute(
        "UPDATE generation_job SET created_at = created_at - interval '1 hour' WHERE id = $1",
        older.id,
    )
    newer = await generation_job_repo.create(
        conn, project_id=project_id, total=2, created_by_sub="op"
    )
    latest = await generation_job_repo.latest_for_project(conn, project_id=project_id)
    assert latest.id == newer.id


async def test_latest_for_project_none_when_no_jobs(conn):
    project_id = await _project(conn)
    assert await generation_job_repo.latest_for_project(conn, project_id=project_id) is None
