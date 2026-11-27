"""commons_repo against a real Postgres; per-test transaction rollback.
Skipped when DATABASE_URL is unset (local / non-DB CI jobs)."""

from __future__ import annotations

import os

import asyncpg
import pytest

from backend.src.library import commons_repo as repo

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


async def _pub(conn, book_id="b1", owner="owner-1", title="Algebra", fmt="epub", bump=True):
    return await repo.upsert_publish(
        conn,
        book_id=book_id,
        owner_sub=owner,
        title=title,
        author_name="Ada",
        account_name="ada",
        description="d",
        language="en",
        cover_svg=None,
        fmt=fmt,
        bump_version=bump,
    )


async def test_upsert_creates_live_entry_version_1(conn):
    e = await _pub(conn)
    assert e.status == "live" and e.version == 1 and e.formats == ["epub"]
    assert (await repo.get_entry(conn, "b1")).title == "Algebra"
    assert await repo.get_entry(conn, "missing") is None


async def test_second_format_does_not_bump_version(conn):
    await _pub(conn)
    e = await _pub(conn, fmt="pdf", bump=False)
    assert e.version == 1 and e.formats == ["epub", "pdf"]


async def test_republish_after_hide_is_live_and_bumps(conn):
    await _pub(conn)
    await repo.set_status(conn, book_id="b1", status="hidden")
    assert (await repo.get_entry(conn, "b1")).status == "hidden"
    e = await _pub(conn)
    assert e.status == "live" and e.version == 2


async def test_upsert_never_changes_owner(conn):
    await _pub(conn, owner="owner-1")
    e = await _pub(conn, owner="intruder")
    assert e.owner_sub == "owner-1"


async def test_list_live_excludes_hidden(conn):
    await _pub(conn, book_id="b1")
    await _pub(conn, book_id="b2", title="Biology")
    await repo.set_status(conn, book_id="b2", status="hidden")
    entries, total = await repo.list_live(conn, query="", language=None, limit=20, offset=0)
    assert [e.book_id for e in entries] == ["b1"] and total == 1


async def test_list_live_escapes_wildcards(conn):
    await _pub(conn)
    entries, total = await repo.list_live(conn, query="%", language=None, limit=20, offset=0)
    assert entries == [] and total == 0
    entries, total = await repo.list_live(conn, query="alg", language="en", limit=20, offset=0)
    assert total == 1


async def test_cover_svg_round_trips(conn):
    svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    await repo.upsert_publish(
        conn,
        book_id="b-cover",
        owner_sub="owner-1",
        title="Algebra",
        author_name="Ada",
        account_name="ada",
        description="d",
        language="en",
        cover_svg=svg,
        fmt="epub",
        bump_version=True,
    )
    assert (await repo.get_entry(conn, "b-cover")).cover_svg == svg


async def test_cover_thumb_is_stored_and_refreshed_on_republish(conn):
    thumb_a = "data:image/jpeg;base64,AAAA"
    thumb_b = "data:image/jpeg;base64,BBBB"
    e = await repo.upsert_publish(
        conn,
        book_id="b1",
        owner_sub="owner-1",
        title="Algebra",
        author_name="Ada",
        account_name="ada",
        description=None,
        language="en",
        cover_svg=None,
        fmt="epub",
        bump_version=True,
        cover_thumb=thumb_a,
    )
    assert e.cover_thumb == thumb_a
    assert (await repo.get_entry(conn, "b1")).cover_thumb == thumb_a
    e = await repo.upsert_publish(
        conn,
        book_id="b1",
        owner_sub="owner-1",
        title="Algebra",
        author_name="Ada",
        account_name="ada",
        description=None,
        language="en",
        cover_svg=None,
        fmt="pdf",
        bump_version=False,
        cover_thumb=thumb_b,
    )
    assert e.cover_thumb == thumb_b
