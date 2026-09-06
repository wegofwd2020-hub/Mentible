from __future__ import annotations

import json
import uuid

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
        INSERT INTO feedback (account_id, name, email, page, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id, created_at
        """,
        account_id,
        name,
        email,
        page,
        json.dumps(payload),
    )
