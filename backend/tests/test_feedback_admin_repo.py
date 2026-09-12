from __future__ import annotations

import asyncio
import json
import os
import uuid

import asyncpg
import pytest

from backend.src.feedback import repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


async def _seed(conn, *, type_, text, cp="feedback_only", app="mentible", page="/x"):
    payload = {"type": type_, "text": text, "contact_preference": cp}
    row = await conn.fetchrow(
        "INSERT INTO app_feedback (account_id, name, email, app, page, payload) "
        "VALUES (NULL,$1,$2,$3,$4,$5::jsonb) RETURNING id",
        "Jane",
        f"{uuid.uuid4()}@x.z",
        app,
        page,
        json.dumps(payload),
    )
    return row["id"]


def test_query_filters_and_keyset():
    async def _run():
        conn = await asyncpg.connect(DSN)
        try:
            b = await _seed(conn, type_="bug", text="upload broke")
            f = await _seed(conn, type_="feature", text="please add export")
            # type filter
            bugs = await repo.query_feedback(conn, type_="bug", limit=100)
            ids = {r["id"] for r in bugs}
            assert b in ids and f not in ids
            # free-text q
            hits = await repo.query_feedback(conn, q="export", limit=100)
            assert f in {r["id"] for r in hits}
            # keyset paging: page size 1 then cursor
            page1 = await repo.query_feedback(conn, limit=1)
            assert len(page1) == 1
            cur = repo.encode_cursor(page1[-1])
            page2 = await repo.query_feedback(conn, limit=1, cursor=cur)
            assert page2 and page2[0]["id"] != page1[0]["id"]
        finally:
            await conn.close()

    asyncio.run(_run())


def test_archive_status_filter_and_hard_delete():
    async def _run():
        conn = await asyncpg.connect(DSN)
        try:
            a = await _seed(conn, type_="bug", text="archive me please")
            k = await _seed(conn, type_="bug", text="keep me active here")

            # archive `a` → drops out of the default active view, shows under archived
            assert await repo.set_archived(conn, a, archived=True) is True
            active = {r["id"] for r in await repo.query_feedback(conn, q="me", limit=100)}
            assert k in active and a not in active
            archived = {
                r["id"]
                for r in await repo.query_feedback(conn, q="me", status="archived", limit=100)
            }
            assert a in archived and k not in archived
            all_ = {
                r["id"] for r in await repo.query_feedback(conn, q="me", status="all", limit=100)
            }
            assert a in all_ and k in all_

            # detail carries the archived_at column
            row = await repo.get_feedback(conn, a)
            assert row is not None and row["archived_at"] is not None

            # restore → back in active
            assert await repo.set_archived(conn, a, archived=False) is True
            active2 = {r["id"] for r in await repo.query_feedback(conn, q="me", limit=100)}
            assert a in active2

            # hard delete removes it entirely
            assert await repo.delete_feedback(conn, k) is True
            assert await repo.get_feedback(conn, k) is None
            # deleting a missing id is a no-op returning False
            assert await repo.delete_feedback(conn, k) is False
            assert await repo.set_archived(conn, k, archived=True) is False
        finally:
            await conn.close()

    asyncio.run(_run())
