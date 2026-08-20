"""Repo-level tests for the zero-knowledge sync store (ADR-014 increment 1).

Mirrors `test_trust_access.py`'s direct-asyncpg fixture pattern. Tests the
`src.sync.repo` layer directly (not the router — auth override is fiddly and
the repo is the real isolation gate per CLAUDE.md rule 4). Every value pushed
in is opaque bytes, exactly as a real ciphertext blob would be — these tests
never construct anything that looks like plaintext content.
"""

import os
import uuid

import asyncpg
import pytest

from src.sync import repo

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


# ── keyset ────────────────────────────────────────────────────────────────


async def test_keyset_roundtrip(conn):
    acc = await _make_account(conn)
    written = await repo.upsert_keyset(
        conn,
        owner_account_id=acc,
        wrapped_lmk=b"\x01wrapped-lmk-bytes",
        lmk_nonce=b"\x02nonce",
        kek_salt=b"\x03salt",
    )
    assert written.wrapped_lmk == b"\x01wrapped-lmk-bytes"

    got = await repo.get_keyset(conn, owner_account_id=acc)
    assert got is not None
    assert got.wrapped_lmk == b"\x01wrapped-lmk-bytes"
    assert got.lmk_nonce == b"\x02nonce"
    assert got.kek_salt == b"\x03salt"


async def test_get_keyset_missing_returns_none(conn):
    acc = await _make_account(conn)
    assert await repo.get_keyset(conn, owner_account_id=acc) is None


async def test_second_upsert_without_force_raises(conn):
    acc = await _make_account(conn)
    await repo.upsert_keyset(
        conn, owner_account_id=acc, wrapped_lmk=b"first", lmk_nonce=b"n1", kek_salt=b"s1"
    )
    with pytest.raises(repo.KeysetExistsError):
        await repo.upsert_keyset(
            conn, owner_account_id=acc, wrapped_lmk=b"second", lmk_nonce=b"n2", kek_salt=b"s2"
        )
    # unchanged
    got = await repo.get_keyset(conn, owner_account_id=acc)
    assert got.wrapped_lmk == b"first"


async def test_second_upsert_with_force_overwrites(conn):
    acc = await _make_account(conn)
    await repo.upsert_keyset(
        conn, owner_account_id=acc, wrapped_lmk=b"first", lmk_nonce=b"n1", kek_salt=b"s1"
    )
    await repo.upsert_keyset(
        conn,
        owner_account_id=acc,
        wrapped_lmk=b"second",
        lmk_nonce=b"n2",
        kek_salt=b"s2",
        force=True,
    )
    got = await repo.get_keyset(conn, owner_account_id=acc)
    assert got.wrapped_lmk == b"second"
    assert got.lmk_nonce == b"n2"
    assert got.kek_salt == b"s2"


# ── books ─────────────────────────────────────────────────────────────────


async def test_book_roundtrip(conn):
    acc = await _make_account(conn)
    ciphertext = bytes(range(256)) * 4  # arbitrary opaque bytes
    written = await repo.upsert_book(
        conn,
        owner_account_id=acc,
        book_id="b1",
        ciphertext=ciphertext,
        nonce=b"nonce-bytes",
        wrapped_dk=b"wrapped-dk-bytes",
        dk_nonce=b"dk-nonce-bytes",
        client_version="v1",
    )
    assert written.ciphertext == ciphertext
    assert written.client_version == "v1"
    assert written.deleted is False

    got = await repo.get_book(conn, owner_account_id=acc, book_id="b1")
    assert got is not None
    assert got.ciphertext == ciphertext
    assert got.nonce == b"nonce-bytes"
    assert got.wrapped_dk == b"wrapped-dk-bytes"
    assert got.dk_nonce == b"dk-nonce-bytes"
    assert got.client_version == "v1"
    assert got.deleted is False


async def test_get_book_missing_returns_none(conn):
    acc = await _make_account(conn)
    assert await repo.get_book(conn, owner_account_id=acc, book_id="nope") is None


async def test_list_books_shows_metadata_only(conn):
    acc = await _make_account(conn)
    await repo.upsert_book(
        conn,
        owner_account_id=acc,
        book_id="b1",
        ciphertext=b"ciphertext-bytes",
        nonce=b"n",
        wrapped_dk=b"wdk",
        dk_nonce=b"dkn",
        client_version="v1",
    )
    listing = await repo.list_books(conn, owner_account_id=acc)
    assert len(listing) == 1
    row = listing[0]
    assert row.book_id == "b1"
    assert row.client_version == "v1"
    assert row.deleted is False
    assert not hasattr(row, "ciphertext")


async def test_tombstone_book_marks_deleted(conn):
    acc = await _make_account(conn)
    await repo.upsert_book(
        conn,
        owner_account_id=acc,
        book_id="b1",
        ciphertext=b"ciphertext-bytes",
        nonce=b"n",
        wrapped_dk=b"wdk",
        dk_nonce=b"dkn",
        client_version="v1",
    )
    ok = await repo.tombstone_book(conn, owner_account_id=acc, book_id="b1")
    assert ok is True

    listing = await repo.list_books(conn, owner_account_id=acc)
    assert len(listing) == 1
    assert listing[0].deleted is True

    got = await repo.get_book(conn, owner_account_id=acc, book_id="b1")
    assert got.deleted is True


async def test_tombstone_missing_book_returns_false(conn):
    acc = await _make_account(conn)
    ok = await repo.tombstone_book(conn, owner_account_id=acc, book_id="nope")
    assert ok is False


# ── isolation (app-level, no RLS — CLAUDE.md rule 4) ────────────────────────


async def test_isolation_book_invisible_across_accounts(conn):
    acc_a = await _make_account(conn)
    acc_b = await _make_account(conn)
    await repo.upsert_book(
        conn,
        owner_account_id=acc_a,
        book_id="b1",
        ciphertext=b"a-secret-ciphertext",
        nonce=b"n",
        wrapped_dk=b"wdk",
        dk_nonce=b"dkn",
        client_version="v1",
    )

    assert await repo.get_book(conn, owner_account_id=acc_b, book_id="b1") is None
    b_listing = await repo.list_books(conn, owner_account_id=acc_b)
    assert b_listing == []

    # A's own view still sees it.
    a_listing = await repo.list_books(conn, owner_account_id=acc_a)
    assert [m.book_id for m in a_listing] == ["b1"]


async def test_isolation_keyset_invisible_across_accounts(conn):
    acc_a = await _make_account(conn)
    acc_b = await _make_account(conn)
    await repo.upsert_keyset(
        conn, owner_account_id=acc_a, wrapped_lmk=b"a-key", lmk_nonce=b"n", kek_salt=b"s"
    )
    assert await repo.get_keyset(conn, owner_account_id=acc_b) is None


async def test_isolation_tombstone_cannot_affect_other_account(conn):
    acc_a = await _make_account(conn)
    acc_b = await _make_account(conn)
    await repo.upsert_book(
        conn,
        owner_account_id=acc_a,
        book_id="b1",
        ciphertext=b"a-secret-ciphertext",
        nonce=b"n",
        wrapped_dk=b"wdk",
        dk_nonce=b"dkn",
        client_version="v1",
    )
    ok = await repo.tombstone_book(conn, owner_account_id=acc_b, book_id="b1")
    assert ok is False

    got = await repo.get_book(conn, owner_account_id=acc_a, book_id="b1")
    assert got.deleted is False
