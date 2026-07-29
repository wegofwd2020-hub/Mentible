"""The single place project authorization is decided (ADR-037 D4 seam).

Owner OR a project_membership row (sub-project c). Still app-level — no RLS.
"""

from __future__ import annotations

import uuid

import asyncpg

PROJECT_ROLES = ("owner", "reviewer")


class ProjectAccessError(Exception):
    """Caller has no access to the project. Routers map this to HTTP 403."""


async def require_project_access(
    conn: asyncpg.Connection, *, account_id: uuid.UUID, project_id: uuid.UUID
) -> str:
    owner = await conn.fetchval("SELECT owner_account_id FROM project WHERE id = $1", project_id)
    if owner is None:
        raise ProjectAccessError(str(project_id))
    if owner == account_id:
        return "owner"
    role = await conn.fetchval(
        "SELECT role FROM project_membership WHERE project_id = $1 AND account_id = $2",
        project_id,
        account_id,
    )
    if role is not None:
        return role
    raise ProjectAccessError(str(project_id))


async def project_id_for_artifact(
    conn: asyncpg.Connection, *, artifact_id: uuid.UUID
) -> uuid.UUID | None:
    return await conn.fetchval("SELECT project_id FROM artifact WHERE id = $1", artifact_id)


async def project_id_for_version(
    conn: asyncpg.Connection, *, version_id: uuid.UUID
) -> uuid.UUID | None:
    return await conn.fetchval(
        "SELECT a.project_id FROM artifact_version v "
        "JOIN artifact a ON a.id = v.artifact_id WHERE v.id = $1",
        version_id,
    )
