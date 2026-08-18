"""Persistence for the per-version LLM source-overlap originality report (B3
Part A). Keyed by (version_id, version_kind); a re-run upserts.
`cited_content_hash` lets the read layer flag a stored report stale when the
cited inputs changed — same mechanism, byte-for-byte, as grounding_repo.py."""

from __future__ import annotations

import json
from uuid import UUID

import asyncpg


async def upsert(
    conn: asyncpg.Connection,
    *,
    version_id: UUID,
    version_kind: str,
    report: dict,
    model: str,
    cited_content_hash: str,
) -> None:
    await conn.execute(
        """INSERT INTO version_originality (version_id, version_kind, report, model, cited_content_hash)
           VALUES ($1,$2,$3::jsonb,$4,$5)
           ON CONFLICT (version_id, version_kind)
           DO UPDATE SET report=EXCLUDED.report, model=EXCLUDED.model,
                         cited_content_hash=EXCLUDED.cited_content_hash, checked_at=now()""",
        version_id,
        version_kind,
        json.dumps(report),
        model,
        cited_content_hash,
    )


async def get(conn: asyncpg.Connection, *, version_id: UUID, version_kind: str) -> dict | None:
    row = await conn.fetchrow(
        "SELECT report, model, checked_at, cited_content_hash FROM version_originality "
        "WHERE version_id=$1 AND version_kind=$2",
        version_id,
        version_kind,
    )
    if row is None:
        return None
    return {
        **json.loads(row["report"]),
        "model": row["model"],
        "checked_at": row["checked_at"].isoformat(),
        "cited_content_hash": row["cited_content_hash"],
    }
