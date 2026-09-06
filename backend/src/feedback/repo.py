from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime

import asyncpg


async def insert_feedback(
    conn: asyncpg.Connection,
    *,
    account_id: uuid.UUID | None,
    name: str,
    email: str,
    page: str,
    payload: dict,
) -> asyncpg.Record:
    """Persist one feedback row. Name/email/created_at are the primary
    identifiers (columns); everything else is the analyzable JSON `payload`."""
    return await conn.fetchrow(
        """
        INSERT INTO app_feedback (account_id, name, email, page, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id, created_at
        """,
        account_id,
        name,
        email,
        page,
        json.dumps(payload),
    )


def encode_cursor(row: asyncpg.Record) -> str:
    raw = f"{row['created_at'].isoformat()}|{row['id']}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    created, id_ = raw.split("|", 1)
    return datetime.fromisoformat(created), uuid.UUID(id_)


async def query_feedback(
    conn: asyncpg.Connection,
    *,
    type_: str | None = None,
    contact_preference: str | None = None,
    page: str | None = None,
    app: str | None = None,
    q: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> list[asyncpg.Record]:
    """Filtered, keyset-paginated feedback, newest first. `type_` and
    `contact_preference` are read from the jsonb payload; the rest are columns."""
    clauses: list[str] = []
    args: list = []

    def bind(value) -> str:
        args.append(value)
        return f"${len(args)}"

    if type_ is not None:
        clauses.append(f"payload->>'type' = {bind(type_)}")
    if contact_preference is not None:
        clauses.append(f"payload->>'contact_preference' = {bind(contact_preference)}")
    if app is not None:
        clauses.append(f"app = {bind(app)}")
    if page is not None:
        clauses.append(f"page ILIKE {bind(f'%{page}%')}")
    if q is not None:
        p = bind(f"%{q}%")
        clauses.append(f"(name ILIKE {p} OR email ILIKE {p} OR payload->>'text' ILIKE {p})")
    if created_from is not None:
        clauses.append(f"created_at >= {bind(created_from)}")
    if created_to is not None:
        clauses.append(f"created_at <= {bind(created_to)}")
    if cursor is not None:
        c_created, c_id = decode_cursor(cursor)
        clauses.append(f"(created_at, id) < ({bind(c_created)}, {bind(c_id)})")

    sql = "SELECT id, name, email, app, page, payload, created_at FROM app_feedback"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += f" ORDER BY created_at DESC, id DESC LIMIT {bind(limit)}"
    return await conn.fetch(sql, *args)


async def get_feedback(conn: asyncpg.Connection, feedback_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT id, name, email, app, page, payload, created_at FROM app_feedback WHERE id = $1",
        feedback_id,
    )
