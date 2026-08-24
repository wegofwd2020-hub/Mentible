"""asyncpg data access for the zero-knowledge sync store (ADR-014 increment 1).

The server stores ciphertext + wrapped keys + salt/nonces ONLY — nothing here
ever decodes a value into plaintext content. Isolation is app-level: every
query is scoped by `owner_account_id`, and the caller only ever obtains that
id by resolving the verified `Principal.sub` through `accounts_repo.get_account`
(CLAUDE.md rule 4 — no RLS, no tenant column beyond this one FK).

Connections are asyncpg `Connection`s acquired from the app pool by the caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg


class KeysetExistsError(Exception):
    """Raised by `upsert_keyset` when a keyset already exists for this account
    and the caller didn't pass `force=True` — refuses a silent overwrite of
    the account's wrapped local-master-key envelope."""


@dataclass
class Keyset:
    owner_account_id: UUID
    wrapped_lmk: bytes
    lmk_nonce: bytes
    kek_salt: bytes
    created_at: datetime | None


@dataclass
class SyncedBook:
    owner_account_id: UUID
    book_id: str
    ciphertext: bytes
    nonce: bytes
    wrapped_dk: bytes
    dk_nonce: bytes
    client_version: str
    deleted: bool
    updated_at: datetime | None


@dataclass
class BookMeta:
    book_id: str
    client_version: str
    deleted: bool
    updated_at: datetime | None


_KEYSET_COLS = "owner_account_id, wrapped_lmk, lmk_nonce, kek_salt, created_at"
_BOOK_COLS = (
    "owner_account_id, book_id, ciphertext, nonce, wrapped_dk, dk_nonce, "
    "client_version, deleted, updated_at"
)
_BOOK_META_COLS = "book_id, client_version, deleted, updated_at"


def _keyset(r: asyncpg.Record) -> Keyset:
    return Keyset(
        owner_account_id=r["owner_account_id"],
        wrapped_lmk=r["wrapped_lmk"],
        lmk_nonce=r["lmk_nonce"],
        kek_salt=r["kek_salt"],
        created_at=r["created_at"],
    )


def _book(r: asyncpg.Record) -> SyncedBook:
    return SyncedBook(
        owner_account_id=r["owner_account_id"],
        book_id=r["book_id"],
        ciphertext=r["ciphertext"],
        nonce=r["nonce"],
        wrapped_dk=r["wrapped_dk"],
        dk_nonce=r["dk_nonce"],
        client_version=r["client_version"],
        deleted=r["deleted"],
        updated_at=r["updated_at"],
    )


def _book_meta(r: asyncpg.Record) -> BookMeta:
    return BookMeta(
        book_id=r["book_id"],
        client_version=r["client_version"],
        deleted=r["deleted"],
        updated_at=r["updated_at"],
    )


async def get_keyset(conn: asyncpg.Connection, *, owner_account_id: Any) -> Keyset | None:
    row = await conn.fetchrow(
        f"SELECT {_KEYSET_COLS} FROM sync_keyset WHERE owner_account_id = $1",
        owner_account_id,
    )
    return _keyset(row) if row else None


async def upsert_keyset(
    conn: asyncpg.Connection,
    *,
    owner_account_id: Any,
    wrapped_lmk: bytes,
    lmk_nonce: bytes,
    kek_salt: bytes,
    force: bool = False,
) -> Keyset:
    """Insert the account's keyset. Without `force`, a plain INSERT (no
    ON CONFLICT) makes the "already exists" check atomic with the write — two
    concurrent unforced PUTs can't both slip through and clobber each other;
    the loser hits the unique-PK violation and gets `KeysetExistsError`.
    With `force`, an upsert overwrites whatever's there."""
    if force:
        row = await conn.fetchrow(
            f"""
            INSERT INTO sync_keyset (owner_account_id, wrapped_lmk, lmk_nonce, kek_salt)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (owner_account_id) DO UPDATE
                SET wrapped_lmk = EXCLUDED.wrapped_lmk,
                    lmk_nonce = EXCLUDED.lmk_nonce,
                    kek_salt = EXCLUDED.kek_salt
            RETURNING {_KEYSET_COLS}
            """,
            owner_account_id,
            wrapped_lmk,
            lmk_nonce,
            kek_salt,
        )
        return _keyset(row)
    try:
        # A savepoint (asyncpg nests automatically inside an existing
        # transaction, e.g. a test fixture's wrapper tx): on UniqueViolation
        # only this statement rolls back, not the caller's whole transaction.
        async with conn.transaction():
            row = await conn.fetchrow(
                f"""
                INSERT INTO sync_keyset (owner_account_id, wrapped_lmk, lmk_nonce, kek_salt)
                VALUES ($1, $2, $3, $4)
                RETURNING {_KEYSET_COLS}
                """,
                owner_account_id,
                wrapped_lmk,
                lmk_nonce,
                kek_salt,
            )
    except asyncpg.UniqueViolationError as e:
        raise KeysetExistsError(str(owner_account_id)) from e
    return _keyset(row)


async def list_books(conn: asyncpg.Connection, *, owner_account_id: Any) -> list[BookMeta]:
    """Metadata only (no ciphertext) — includes tombstones (`deleted=true`)
    so a syncing client can learn about remote deletes."""
    rows = await conn.fetch(
        f"SELECT {_BOOK_META_COLS} FROM synced_book "
        "WHERE owner_account_id = $1 ORDER BY updated_at DESC",
        owner_account_id,
    )
    return [_book_meta(r) for r in rows]


async def get_book(
    conn: asyncpg.Connection, *, owner_account_id: Any, book_id: str
) -> SyncedBook | None:
    row = await conn.fetchrow(
        f"SELECT {_BOOK_COLS} FROM synced_book WHERE owner_account_id = $1 AND book_id = $2",
        owner_account_id,
        book_id,
    )
    return _book(row) if row else None


async def upsert_book(
    conn: asyncpg.Connection,
    *,
    owner_account_id: Any,
    book_id: str,
    ciphertext: bytes,
    nonce: bytes,
    wrapped_dk: bytes,
    dk_nonce: bytes,
    client_version: str,
) -> SyncedBook:
    """Insert/overwrite one book's ciphertext. A re-PUT of a previously
    tombstoned book_id revives it (`deleted` reset to false) — pushing a new
    version is how a client "undeletes"."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO synced_book
            (owner_account_id, book_id, ciphertext, nonce, wrapped_dk, dk_nonce,
             client_version, deleted, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, now())
        ON CONFLICT (owner_account_id, book_id) DO UPDATE
            SET ciphertext = EXCLUDED.ciphertext,
                nonce = EXCLUDED.nonce,
                wrapped_dk = EXCLUDED.wrapped_dk,
                dk_nonce = EXCLUDED.dk_nonce,
                client_version = EXCLUDED.client_version,
                deleted = false,
                updated_at = now()
        RETURNING {_BOOK_COLS}
        """,
        owner_account_id,
        book_id,
        ciphertext,
        nonce,
        wrapped_dk,
        dk_nonce,
        client_version,
    )
    return _book(row)


async def tombstone_book(conn: asyncpg.Connection, *, owner_account_id: Any, book_id: str) -> bool:
    """Marks a book deleted (soft delete — the row + its metadata stay so
    other devices learn about the delete on their next `list_books`). Returns
    False when there was no such book for this account (caller 404s)."""
    result = await conn.execute(
        "UPDATE synced_book SET deleted = true, updated_at = now() "
        "WHERE owner_account_id = $1 AND book_id = $2",
        owner_account_id,
        book_id,
    )
    return result != "UPDATE 0"


# ── synced_epub (ADR-014 increment 2) ───────────────────────────────────────
#
# `ciphertext`/`nonce` are the epub bytes; `meta_ciphertext`/`meta_nonce` are a
# SEPARATE opaque sidecar (title, cover, etc — up to ~600KB) so the client can
# fetch/decrypt metadata independent of the (much larger) epub payload framing.
# Both travel wrapped by the same per-epub data key (`wrapped_dk`/`dk_nonce`).


@dataclass
class SyncedEpub:
    owner_account_id: UUID
    epub_id: str
    ciphertext: bytes
    nonce: bytes
    meta_ciphertext: bytes
    meta_nonce: bytes
    wrapped_dk: bytes
    dk_nonce: bytes
    client_version: str
    byte_size: int
    deleted: bool
    updated_at: datetime | None


@dataclass
class EpubMeta:
    epub_id: str
    client_version: str
    deleted: bool
    updated_at: datetime | None
    byte_size: int


_EPUB_COLS = (
    "owner_account_id, epub_id, ciphertext, nonce, meta_ciphertext, meta_nonce, "
    "wrapped_dk, dk_nonce, client_version, byte_size, deleted, updated_at"
)
_EPUB_META_COLS = "epub_id, client_version, deleted, updated_at, byte_size"


def _epub(r: asyncpg.Record) -> SyncedEpub:
    return SyncedEpub(
        owner_account_id=r["owner_account_id"],
        epub_id=r["epub_id"],
        ciphertext=r["ciphertext"],
        nonce=r["nonce"],
        meta_ciphertext=r["meta_ciphertext"],
        meta_nonce=r["meta_nonce"],
        wrapped_dk=r["wrapped_dk"],
        dk_nonce=r["dk_nonce"],
        client_version=r["client_version"],
        byte_size=r["byte_size"],
        deleted=r["deleted"],
        updated_at=r["updated_at"],
    )


def _epub_meta(r: asyncpg.Record) -> EpubMeta:
    return EpubMeta(
        epub_id=r["epub_id"],
        client_version=r["client_version"],
        deleted=r["deleted"],
        updated_at=r["updated_at"],
        byte_size=r["byte_size"],
    )


async def list_epubs(conn: asyncpg.Connection, *, owner_account_id: Any) -> list[EpubMeta]:
    """Metadata only (no ciphertext) — includes tombstones (`deleted=true`) so
    a syncing client can learn about remote deletes."""
    rows = await conn.fetch(
        f"SELECT {_EPUB_META_COLS} FROM synced_epub "
        "WHERE owner_account_id = $1 ORDER BY updated_at DESC",
        owner_account_id,
    )
    return [_epub_meta(r) for r in rows]


async def get_epub(
    conn: asyncpg.Connection, *, owner_account_id: Any, epub_id: str
) -> SyncedEpub | None:
    row = await conn.fetchrow(
        f"SELECT {_EPUB_COLS} FROM synced_epub WHERE owner_account_id = $1 AND epub_id = $2",
        owner_account_id,
        epub_id,
    )
    return _epub(row) if row else None


async def upsert_epub(
    conn: asyncpg.Connection,
    *,
    owner_account_id: Any,
    epub_id: str,
    ciphertext: bytes,
    nonce: bytes,
    meta_ciphertext: bytes,
    meta_nonce: bytes,
    wrapped_dk: bytes,
    dk_nonce: bytes,
    client_version: str,
    byte_size: int,
) -> SyncedEpub:
    """Insert/overwrite one epub's ciphertext + meta sidecar. A re-PUT of a
    previously tombstoned epub_id revives it (`deleted` reset to false)."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO synced_epub
            (owner_account_id, epub_id, ciphertext, nonce, meta_ciphertext, meta_nonce,
             wrapped_dk, dk_nonce, client_version, byte_size, deleted, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, now())
        ON CONFLICT (owner_account_id, epub_id) DO UPDATE
            SET ciphertext = EXCLUDED.ciphertext,
                nonce = EXCLUDED.nonce,
                meta_ciphertext = EXCLUDED.meta_ciphertext,
                meta_nonce = EXCLUDED.meta_nonce,
                wrapped_dk = EXCLUDED.wrapped_dk,
                dk_nonce = EXCLUDED.dk_nonce,
                client_version = EXCLUDED.client_version,
                byte_size = EXCLUDED.byte_size,
                deleted = false,
                updated_at = now()
        RETURNING {_EPUB_COLS}
        """,
        owner_account_id,
        epub_id,
        ciphertext,
        nonce,
        meta_ciphertext,
        meta_nonce,
        wrapped_dk,
        dk_nonce,
        client_version,
        byte_size,
    )
    return _epub(row)


async def tombstone_epub(conn: asyncpg.Connection, *, owner_account_id: Any, epub_id: str) -> bool:
    """Marks an epub deleted (soft delete) and zeroes its `byte_size` so it no
    longer counts against the account's soft storage cap. Returns False when
    there was no such epub for this account (caller 404s)."""
    result = await conn.execute(
        "UPDATE synced_epub SET deleted = true, byte_size = 0, updated_at = now() "
        "WHERE owner_account_id = $1 AND epub_id = $2",
        owner_account_id,
        epub_id,
    )
    return result != "UPDATE 0"


async def get_epub_byte_size(
    conn: asyncpg.Connection, *, owner_account_id: Any, epub_id: str
) -> int | None:
    """Lightweight lookup for the cap check — just `byte_size`, never the
    multi-MB `ciphertext`/`meta_ciphertext` columns `get_epub` would pull back.
    Returns None when there is no such epub for this account (a fresh upload,
    not a re-upload)."""
    return await conn.fetchval(
        "SELECT byte_size FROM synced_epub WHERE owner_account_id = $1 AND epub_id = $2",
        owner_account_id,
        epub_id,
    )


async def user_epub_total_bytes(conn: asyncpg.Connection, *, owner_account_id: Any) -> int:
    """Sum of `byte_size` across all non-deleted epubs for this account — the
    live figure the soft storage cap is checked against."""
    total = await conn.fetchval(
        "SELECT COALESCE(SUM(byte_size), 0) FROM synced_epub "
        "WHERE owner_account_id = $1 AND NOT deleted",
        owner_account_id,
    )
    return int(total)


# ── synced_shelves (ADR-014 increment 2) ────────────────────────────────────


@dataclass
class SyncedShelves:
    owner_account_id: UUID
    ciphertext: bytes
    nonce: bytes
    wrapped_dk: bytes
    dk_nonce: bytes
    client_version: str
    updated_at: datetime | None


_SHELVES_COLS = (
    "owner_account_id, ciphertext, nonce, wrapped_dk, dk_nonce, client_version, updated_at"
)


def _shelves(r: asyncpg.Record) -> SyncedShelves:
    return SyncedShelves(
        owner_account_id=r["owner_account_id"],
        ciphertext=r["ciphertext"],
        nonce=r["nonce"],
        wrapped_dk=r["wrapped_dk"],
        dk_nonce=r["dk_nonce"],
        client_version=r["client_version"],
        updated_at=r["updated_at"],
    )


async def get_shelves(conn: asyncpg.Connection, *, owner_account_id: Any) -> SyncedShelves | None:
    row = await conn.fetchrow(
        f"SELECT {_SHELVES_COLS} FROM synced_shelves WHERE owner_account_id = $1",
        owner_account_id,
    )
    return _shelves(row) if row else None


async def upsert_shelves(
    conn: asyncpg.Connection,
    *,
    owner_account_id: Any,
    ciphertext: bytes,
    nonce: bytes,
    wrapped_dk: bytes,
    dk_nonce: bytes,
    client_version: str,
) -> SyncedShelves:
    """Insert/overwrite the account's single shelves blob."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO synced_shelves
            (owner_account_id, ciphertext, nonce, wrapped_dk, dk_nonce, client_version, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (owner_account_id) DO UPDATE
            SET ciphertext = EXCLUDED.ciphertext,
                nonce = EXCLUDED.nonce,
                wrapped_dk = EXCLUDED.wrapped_dk,
                dk_nonce = EXCLUDED.dk_nonce,
                client_version = EXCLUDED.client_version,
                updated_at = now()
        RETURNING {_SHELVES_COLS}
        """,
        owner_account_id,
        ciphertext,
        nonce,
        wrapped_dk,
        dk_nonce,
        client_version,
    )
    return _shelves(row)
