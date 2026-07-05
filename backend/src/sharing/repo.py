"""Registry access for hosted draft sharing (ADR-027 D2-D4): shared_draft,
draft_invitation, draft_comment. Mirrors library/published_repo."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

import asyncpg


@dataclass
class SharedDraft:
    book_id: str
    owner_sub: str
    version: str
    title: str
    book_json: dict
    created_at: datetime
    updated_at: datetime


def _draft(r: asyncpg.Record) -> SharedDraft:
    bj = r["book_json"]
    return SharedDraft(
        book_id=r["book_id"],
        owner_sub=r["owner_sub"],
        version=r["version"],
        title=r["title"],
        book_json=json.loads(bj) if isinstance(bj, str) else bj,
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


async def claim_or_share(conn: asyncpg.Connection, *, book_id: str, sub: str) -> bool:
    """First-share-wins ownership. Inserts a placeholder row for `book_id` owned by
    `sub` if unowned, then returns True iff `sub` owns it. A different sub → False
    (caller refuses). Atomic under the row's ON CONFLICT DO NOTHING + re-read."""
    await conn.execute(
        """
        INSERT INTO shared_draft (book_id, owner_sub, version, title, book_json)
        VALUES ($1, $2, '', '', '{}'::jsonb)
        ON CONFLICT (book_id) DO NOTHING
        """,
        book_id,
        sub,
    )
    owner = await conn.fetchval("SELECT owner_sub FROM shared_draft WHERE book_id = $1", book_id)
    return owner == sub


async def upsert_draft(
    conn: asyncpg.Connection,
    *,
    book_id: str,
    owner_sub: str,
    version: str,
    title: str,
    book_json: dict,
) -> None:
    """Store/replace the draft content for an owned book (call after claim_or_share)."""
    await conn.execute(
        """
        INSERT INTO shared_draft (book_id, owner_sub, version, title, book_json, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, now())
        ON CONFLICT (book_id) DO UPDATE SET
            version    = EXCLUDED.version,
            title      = EXCLUDED.title,
            book_json  = EXCLUDED.book_json,
            updated_at = now()
        """,
        book_id,
        owner_sub,
        version,
        title,
        json.dumps(book_json),
    )


async def get_draft(conn: asyncpg.Connection, *, book_id: str) -> SharedDraft | None:
    r = await conn.fetchrow("SELECT * FROM shared_draft WHERE book_id = $1", book_id)
    return _draft(r) if r else None
