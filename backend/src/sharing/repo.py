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


@dataclass
class Invitation:
    invited_email: str
    invited_by_sub: str
    created_at: datetime
    revoked_at: datetime | None


async def add_invitation(conn: asyncpg.Connection, *, book_id: str, email: str, invited_by_sub: str) -> None:
    """Invite (or re-invite) an email. Re-inviting a revoked row reactivates it."""
    await conn.execute(
        """
        INSERT INTO draft_invitation (book_id, invited_email, invited_by_sub)
        VALUES ($1, $2, $3)
        ON CONFLICT (book_id, invited_email) DO UPDATE SET
            revoked_at = NULL, invited_by_sub = EXCLUDED.invited_by_sub
        """,
        book_id,
        email.lower(),
        invited_by_sub,
    )


async def list_invitations(conn: asyncpg.Connection, *, book_id: str) -> list[Invitation]:
    rows = await conn.fetch(
        "SELECT invited_email, invited_by_sub, created_at, revoked_at "
        "FROM draft_invitation WHERE book_id = $1 ORDER BY created_at",
        book_id,
    )
    return [Invitation(r["invited_email"], r["invited_by_sub"], r["created_at"], r["revoked_at"]) for r in rows]


async def revoke_invitation(conn: asyncpg.Connection, *, book_id: str, email: str) -> bool:
    row = await conn.fetchrow(
        "UPDATE draft_invitation SET revoked_at = now() "
        "WHERE book_id = $1 AND invited_email = $2 AND revoked_at IS NULL RETURNING id",
        book_id,
        email.lower(),
    )
    return row is not None


async def draft_access(conn: asyncpg.Connection, *, book_id: str, sub: str, email: str | None) -> str | None:
    """'owner' if sub owns the draft; else 'invited' if email has an active invite; else None."""
    owner = await conn.fetchval("SELECT owner_sub FROM shared_draft WHERE book_id = $1", book_id)
    if owner is None:
        return None
    if owner == sub:
        return "owner"
    if not email:
        return None
    invited = await conn.fetchval(
        "SELECT 1 FROM draft_invitation "
        "WHERE book_id = $1 AND invited_email = $2 AND revoked_at IS NULL",
        book_id,
        email.lower(),
    )
    return "invited" if invited else None


@dataclass
class SharedWithMe:
    book_id: str
    title: str
    owner_sub: str
    version: str
    updated_at: datetime


async def shared_with_me(conn: asyncpg.Connection, *, email: str | None) -> list[SharedWithMe]:
    if not email:
        return []
    rows = await conn.fetch(
        """
        SELECT d.book_id, d.title, d.owner_sub, d.version, d.updated_at
        FROM shared_draft d
        JOIN draft_invitation i ON i.book_id = d.book_id
        WHERE i.invited_email = $1 AND i.revoked_at IS NULL
        ORDER BY d.updated_at DESC
        """,
        email.lower(),
    )
    return [SharedWithMe(r["book_id"], r["title"], r["owner_sub"], r["version"], r["updated_at"]) for r in rows]


@dataclass
class Comment:
    id: int
    version: str
    author_sub: str
    author_email: str | None
    body: str
    author_response: str | None
    responded_at: datetime | None
    created_at: datetime


def _comment(r: asyncpg.Record) -> Comment:
    return Comment(
        id=r["id"], version=r["version"], author_sub=r["author_sub"], author_email=r["author_email"],
        body=r["body"], author_response=r["author_response"], responded_at=r["responded_at"], created_at=r["created_at"],
    )


async def add_comment(
    conn: asyncpg.Connection, *, book_id: str, version: str, author_sub: str, author_email: str | None, body: str
) -> Comment:
    r = await conn.fetchrow(
        """
        INSERT INTO draft_comment (book_id, version, author_sub, author_email, body)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
        """,
        book_id, version, author_sub, author_email, body,
    )
    return _comment(r)


async def list_comments(conn: asyncpg.Connection, *, book_id: str, version: str) -> list[Comment]:
    rows = await conn.fetch(
        "SELECT * FROM draft_comment WHERE book_id = $1 AND version = $2 ORDER BY created_at",
        book_id, version,
    )
    return [_comment(r) for r in rows]


async def set_response(conn: asyncpg.Connection, *, book_id: str, comment_id: int, response: str) -> Comment | None:
    """Owner-only author response. Empty/whitespace clears it. None if the comment
    isn't on this book (authz that the caller is the owner happens in the router)."""
    clean = response.strip()
    r = await conn.fetchrow(
        """
        UPDATE draft_comment
        SET author_response = $3::text, responded_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
        WHERE id = $1 AND book_id = $2 RETURNING *
        """,
        comment_id, book_id, (clean or None),
    )
    return _comment(r) if r else None
