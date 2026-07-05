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


async def _seed(conn, book_id="b1", owner="author-1"):
    await repo.claim_or_share(conn, book_id=book_id, sub=owner)
    await repo.upsert_draft(
        conn, book_id=book_id, owner_sub=owner, version="1.0", title="T", book_json={"id": book_id}
    )


async def test_invitations_add_list_revoke(conn):
    await _seed(conn)
    await repo.add_invitation(conn, book_id="b1", email="Alice@x.com", invited_by_sub="author-1")
    inv = await repo.list_invitations(conn, book_id="b1")
    assert len(inv) == 1 and inv[0].invited_email == "alice@x.com" and inv[0].revoked_at is None
    assert await repo.revoke_invitation(conn, book_id="b1", email="alice@x.com") is True
    assert (await repo.list_invitations(conn, book_id="b1"))[0].revoked_at is not None
    # re-invite reactivates the same row
    await repo.add_invitation(conn, book_id="b1", email="alice@x.com", invited_by_sub="author-1")
    assert (await repo.list_invitations(conn, book_id="b1"))[0].revoked_at is None


async def test_draft_access(conn):
    await _seed(conn)
    await repo.add_invitation(conn, book_id="b1", email="alice@x.com", invited_by_sub="author-1")
    assert (
        await repo.draft_access(conn, book_id="b1", sub="author-1", email="author@x.com") == "owner"
    )
    assert await repo.draft_access(conn, book_id="b1", sub="s2", email="ALICE@x.com") == "invited"
    assert await repo.draft_access(conn, book_id="b1", sub="s3", email="bob@x.com") is None
    assert await repo.draft_access(conn, book_id="b1", sub="s4", email=None) is None
    await repo.revoke_invitation(conn, book_id="b1", email="alice@x.com")
    assert await repo.draft_access(conn, book_id="b1", sub="s2", email="alice@x.com") is None


async def test_shared_with_me(conn):
    await _seed(conn, book_id="b1")
    await _seed(conn, book_id="b2")
    await repo.add_invitation(conn, book_id="b1", email="alice@x.com", invited_by_sub="author-1")
    await repo.add_invitation(conn, book_id="b2", email="alice@x.com", invited_by_sub="author-1")
    await repo.revoke_invitation(conn, book_id="b2", email="alice@x.com")
    mine = await repo.shared_with_me(conn, email="alice@x.com")
    assert [m.book_id for m in mine] == ["b1"]  # revoked b2 excluded
    assert await repo.shared_with_me(conn, email=None) == []


async def test_comments_version_scoped(conn):
    await _seed(conn)
    c = await repo.add_comment(
        conn, book_id="b1", version="1.0", author_sub="s2", author_email="a@x.com", body="fix ch2"
    )
    assert c.body == "fix ch2" and c.author_response is None and c.version == "1.0"
    await repo.add_comment(
        conn, book_id="b1", version="1.1", author_sub="s2", author_email="a@x.com", body="on v1.1"
    )
    v10 = await repo.list_comments(conn, book_id="b1", version="1.0")
    assert [x.body for x in v10] == ["fix ch2"]  # v1.1 comment not surfaced


async def test_set_and_clear_response(conn):
    await _seed(conn)
    c = await repo.add_comment(
        conn, book_id="b1", version="1.0", author_sub="s2", author_email="a@x.com", body="q"
    )
    updated = await repo.set_response(conn, book_id="b1", comment_id=c.id, response="answered")
    assert (
        updated is not None
        and updated.author_response == "answered"
        and updated.responded_at is not None
    )
    cleared = await repo.set_response(conn, book_id="b1", comment_id=c.id, response="   ")
    assert cleared.author_response is None and cleared.responded_at is None
    # a comment id not on this book → None
    assert await repo.set_response(conn, book_id="other", comment_id=c.id, response="x") is None


async def test_owned_drafts_with_comments(conn):
    await _seed(conn, book_id="b1", owner="author-1")  # _seed sets version "1.0"
    await _seed(conn, book_id="b2", owner="author-1")  # shared but no comments
    await repo.add_comment(
        conn, book_id="b1", version="1.0", author_sub="s2", author_email="a@x.com", body="one"
    )
    await repo.add_comment(
        conn, book_id="b1", version="1.0", author_sub="s3", author_email="b@x.com", body="two"
    )
    await repo.add_comment(
        conn, book_id="b1", version="2.0", author_sub="s2", author_email="a@x.com", body="other-ver"
    )
    await _seed(conn, book_id="b3", owner="other-owner")
    await repo.add_comment(
        conn, book_id="b3", version="1.0", author_sub="s2", author_email="a@x.com", body="x"
    )
    mine = await repo.owned_drafts_with_comments(conn, owner_sub="author-1")
    assert [m.book_id for m in mine] == ["b1"]  # b2 has 0 comments, b3 is another owner
    assert mine[0].comment_count == 2  # v1.0 only — the v2.0 comment is not counted
    assert mine[0].last_comment_at is not None
    assert await repo.owned_drafts_with_comments(conn, owner_sub="nobody") == []
