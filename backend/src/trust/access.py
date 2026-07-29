"""The single place project authorization is decided (ADR-037 D4 seam).

MVP: owner-only. When expert-login lands (sub-project c), add a
project_membership table and ONE `OR EXISTS (...)` branch here — endpoints
and child repos are untouched.
"""

from __future__ import annotations

import uuid

import asyncpg

PROJECT_ROLES = ("owner",)  # + "reviewer" later


class ProjectAccessError(Exception):
    """Caller has no access to the project. Routers map this to HTTP 403."""


async def require_project_access(
    conn: asyncpg.Connection, *, account_id: uuid.UUID, project_id: uuid.UUID
) -> str:
    owner = await conn.fetchval("SELECT owner_account_id FROM project WHERE id = $1", project_id)
    if owner is None or owner != account_id:
        raise ProjectAccessError(str(project_id))
    return "owner"
