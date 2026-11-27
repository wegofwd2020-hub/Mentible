"""Author Commons catalog access (author_commons_entry). Metadata only."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import asyncpg


@dataclass
class CommonsEntry:
    book_id: str
    owner_sub: str
    title: str
    author_name: str
    account_name: str
    version: int
    published_at: datetime
    cover_svg: str | None  # SVG markup of the book's metadata.coverSvg
    cover_thumb: str | None  # data:image/jpeg;base64 of metadata.coverThumb
    description: str | None
    language: str | None
    formats: list[str]
    status: str  # "live" | "hidden"


def _row(r: asyncpg.Record) -> CommonsEntry:
    return CommonsEntry(
        book_id=r["book_id"],
        owner_sub=r["owner_sub"],
        title=r["title"],
        author_name=r["author_name"],
        account_name=r["account_name"],
        version=r["version"],
        published_at=r["published_at"],
        cover_svg=r["cover_svg"],
        cover_thumb=r["cover_thumb"],
        description=r["description"],
        language=r["language"],
        formats=list(r["formats"]),
        status=r["status"],
    )


async def get_entry(conn: asyncpg.Connection, book_id: str) -> CommonsEntry | None:
    r = await conn.fetchrow("SELECT * FROM author_commons_entry WHERE book_id = $1", book_id)
    return _row(r) if r else None


async def upsert_publish(
    conn: asyncpg.Connection,
    *,
    book_id: str,
    owner_sub: str,
    title: str,
    author_name: str,
    account_name: str,
    description: str | None,
    language: str | None,
    cover_svg: str | None,
    fmt: str,
    bump_version: bool,
    cover_thumb: str | None = None,
) -> CommonsEntry:
    """Create or update the catalog row, set it live, and add `fmt` to formats.
    `version` increments on conflict only when `bump_version`. `owner_sub` is never
    changed on conflict. `cover_thumb` is the shelf thumbnail (a JPEG data URI)."""
    r = await conn.fetchrow(
        """
        INSERT INTO author_commons_entry
            (book_id, owner_sub, title, author_name, account_name, version,
             published_at, cover_svg, description, language, formats, status, updated_at,
             cover_thumb)
        VALUES ($1, $2, $3, $4, $5, 1, now(), $6, $7, $8, ARRAY[$9::text], 'live', now(),
                $11)
        ON CONFLICT (book_id) DO UPDATE SET
            title        = EXCLUDED.title,
            author_name  = EXCLUDED.author_name,
            account_name = EXCLUDED.account_name,
            cover_svg    = EXCLUDED.cover_svg,
            cover_thumb  = EXCLUDED.cover_thumb,
            description  = EXCLUDED.description,
            language     = EXCLUDED.language,
            formats      = ARRAY(
                SELECT DISTINCT unnest(author_commons_entry.formats || ARRAY[$9::text])
                ORDER BY 1),
            version      = author_commons_entry.version + CASE WHEN $10 THEN 1 ELSE 0 END,
            published_at = now(),
            status       = 'live',
            updated_at   = now()
        RETURNING *
        """,
        book_id,
        owner_sub,
        title,
        author_name,
        account_name,
        cover_svg,
        description,
        language,
        fmt,
        bump_version,
        cover_thumb,
    )
    return _row(r)


async def set_status(conn: asyncpg.Connection, *, book_id: str, status: str) -> None:
    await conn.execute(
        "UPDATE author_commons_entry SET status = $2, updated_at = now() WHERE book_id = $1",
        book_id,
        status,
    )


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


_COUNT_LIVE = r"""
SELECT count(*) FROM author_commons_entry
WHERE status = 'live'
  AND (title ILIKE $1 ESCAPE '\' OR author_name ILIKE $1 ESCAPE '\')
  AND ($2::text IS NULL OR language = $2)
"""
_LIST_LIVE = r"""
SELECT * FROM author_commons_entry
WHERE status = 'live'
  AND (title ILIKE $1 ESCAPE '\' OR author_name ILIKE $1 ESCAPE '\')
  AND ($2::text IS NULL OR language = $2)
ORDER BY published_at DESC, book_id
LIMIT $3 OFFSET $4
"""


async def list_live(
    conn: asyncpg.Connection,
    *,
    query: str,
    language: str | None,
    limit: int,
    offset: int,
) -> tuple[list[CommonsEntry], int]:
    pattern = f"%{_escape_like(query)}%"
    total = await conn.fetchval(_COUNT_LIVE, pattern, language)
    rows = await conn.fetch(_LIST_LIVE, pattern, language, limit, offset)
    return [_row(r) for r in rows], total
