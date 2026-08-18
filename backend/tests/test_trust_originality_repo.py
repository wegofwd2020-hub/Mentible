"""TDD for `originality_repo` (B3 T1) — persistence for the per-version LLM
source-overlap originality report. Mirrors `test_generation_job_repo.py`'s
DB-transaction fixture; the upsert/get shape mirrors `version_grounding`
exactly (grounding_repo.py) — a re-run upserts rather than duplicating, and
`get` merges `model`/`checked_at`/`cited_content_hash` into the stored report
dict so the caller can pop `cited_content_hash` for the read-time stale
check (tested at the router layer in Task 2)."""

import os
import uuid

import asyncpg
import pytest

from backend.src.trust import artifact_repo, originality_repo, project_repo

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


async def _artifact_version(conn, project_id):
    art = await artifact_repo.create_artifact(
        conn, project_id=project_id, role="cornerstone", format="guide"
    )
    v = await artifact_repo.create_version(
        conn, artifact_id=art.id, content={"sections": []}, created_by_sub="owner-sub"
    )
    return v.id


async def test_get_returns_none_when_no_report_stored(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    assert await originality_repo.get(conn, version_id=version_id, version_kind="artifact") is None


async def test_upsert_then_get_round_trips_the_report(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    report = {
        "sections": [
            {"index": 0, "heading": "H", "overlap": "none", "note": None, "source_ref": None}
        ],
        "summary": {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1},
    }
    await originality_repo.upsert(
        conn,
        version_id=version_id,
        version_kind="artifact",
        report=report,
        model="m",
        cited_content_hash="h1",
    )
    got = await originality_repo.get(conn, version_id=version_id, version_kind="artifact")
    assert got is not None
    assert got["summary"] == {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1}
    assert got["model"] == "m"
    assert got["cited_content_hash"] == "h1"


async def test_rerun_upserts_rather_than_duplicating(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    report1 = {"sections": [], "summary": {"verbatim": 0, "paraphrase": 0, "clean": 0, "total": 0}}
    report2 = {"sections": [], "summary": {"verbatim": 1, "paraphrase": 0, "clean": 0, "total": 1}}
    await originality_repo.upsert(
        conn,
        version_id=version_id,
        version_kind="artifact",
        report=report1,
        model="m1",
        cited_content_hash="h1",
    )
    await originality_repo.upsert(
        conn,
        version_id=version_id,
        version_kind="artifact",
        report=report2,
        model="m2",
        cited_content_hash="h2",
    )
    rows = await conn.fetch(
        "SELECT model FROM version_originality WHERE version_id=$1 AND version_kind='artifact'",
        version_id,
    )
    assert len(rows) == 1
    assert rows[0]["model"] == "m2"


async def test_artifact_and_topic_kinds_are_independent_rows(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    report = {"sections": [], "summary": {"verbatim": 0, "paraphrase": 0, "clean": 0, "total": 0}}
    await originality_repo.upsert(
        conn,
        version_id=version_id,
        version_kind="artifact",
        report=report,
        model="m",
        cited_content_hash="h",
    )
    assert await originality_repo.get(conn, version_id=version_id, version_kind="topic") is None
