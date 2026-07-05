"""sharing repo against a real Postgres; per-test transaction rollback.
Skipped when DATABASE_URL is unset (local / non-DB CI jobs)."""

from __future__ import annotations

import os

import asyncpg
import pytest

from backend.src.sharing import repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tr = c.transaction()
    await tr.start()
    try:
        yield c
    finally:
        await tr.rollback()
        await c.close()


async def test_claim_or_share_first_wins(conn):
    assert await repo.claim_or_share(conn, book_id="b1", sub="author-1") is True
    # same owner re-claims fine
    assert await repo.claim_or_share(conn, book_id="b1", sub="author-1") is True
    # a different sub cannot claim an owned draft
    assert await repo.claim_or_share(conn, book_id="b1", sub="other") is False


async def test_upsert_and_get_draft(conn):
    await repo.claim_or_share(conn, book_id="b2", sub="author-1")
    await repo.upsert_draft(
        conn, book_id="b2", owner_sub="author-1", version="1.0", title="T", book_json={"id": "b2"}
    )
    d = await repo.get_draft(conn, book_id="b2")
    assert d is not None and d.owner_sub == "author-1" and d.version == "1.0"
    assert d.title == "T" and d.book_json == {"id": "b2"}
    # re-share (new version) replaces content
    await repo.upsert_draft(
        conn,
        book_id="b2",
        owner_sub="author-1",
        version="1.1",
        title="T2",
        book_json={"id": "b2", "v": 2},
    )
    d2 = await repo.get_draft(conn, book_id="b2")
    assert d2.version == "1.1" and d2.title == "T2" and d2.book_json["v"] == 2


async def test_get_missing_draft_is_none(conn):
    assert await repo.get_draft(conn, book_id="nope") is None
