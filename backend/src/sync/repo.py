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
