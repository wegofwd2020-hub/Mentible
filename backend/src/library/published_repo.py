"""Registry access for published Open-Library artifacts (published_artifact)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import asyncpg


@dataclass
class PublishedArtifact:
    book_id: str
    format: str
    content_hash: str
    size_bytes: int
    filename: str
    storage_path: str
    published_by_sub: str | None
    published_at: datetime


async def claim_or_check_owner(conn: asyncpg.Connection, *, book_id: str, sub: str) -> bool:
    """First-publisher-wins ownership. Claims `book_id` for `sub` if unowned, then
    returns True iff `sub` owns it. False means another principal already owns it
    (caller should refuse the publish). The INSERT..ON CONFLICT DO NOTHING +
    re-read is atomic under the row lock, so concurrent first-publishes can't both
    win."""
    await conn.execute(
        """
        INSERT INTO published_book_owner (book_id, owner_sub)
        VALUES ($1, $2)
        ON CONFLICT (book_id) DO NOTHING
        """,
        book_id,
        sub,
    )
    owner = await conn.fetchval(
        "SELECT owner_sub FROM published_book_owner WHERE book_id = $1", book_id
    )
    return owner == sub


async def upsert(
    conn: asyncpg.Connection,
    *,
    book_id: str,
    fmt: str,
    content_hash: str,
    size_bytes: int,
    filename: str,
    storage_path: str,
    published_by_sub: str | None,
) -> None:
    """Publish (or re-publish) one (book, format). Republish replaces the row."""
    await conn.execute(
        """
        INSERT INTO published_artifact
            (book_id, format, content_hash, size_bytes, filename, storage_path,
             published_by_sub, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (book_id, format) DO UPDATE SET
            content_hash     = EXCLUDED.content_hash,
            size_bytes       = EXCLUDED.size_bytes,
            filename         = EXCLUDED.filename,
            storage_path     = EXCLUDED.storage_path,
            published_by_sub = EXCLUDED.published_by_sub,
            published_at     = now()
        """,
        book_id,
        fmt,
        content_hash,
        size_bytes,
        filename,
        storage_path,
        published_by_sub,
    )


def _row(r: asyncpg.Record) -> PublishedArtifact:
    return PublishedArtifact(
        book_id=r["book_id"],
        format=r["format"],
        content_hash=r["content_hash"],
        size_bytes=r["size_bytes"],
        filename=r["filename"],
        storage_path=r["storage_path"],
        published_by_sub=r["published_by_sub"],
        published_at=r["published_at"],
    )


async def list_for_book(conn: asyncpg.Connection, book_id: str) -> list[PublishedArtifact]:
    rows = await conn.fetch(
        "SELECT * FROM published_artifact WHERE book_id = $1 ORDER BY format", book_id
    )
    return [_row(r) for r in rows]


async def get_one(conn: asyncpg.Connection, book_id: str, fmt: str) -> PublishedArtifact | None:
    r = await conn.fetchrow(
        "SELECT * FROM published_artifact WHERE book_id = $1 AND format = $2", book_id, fmt
    )
    return _row(r) if r else None
