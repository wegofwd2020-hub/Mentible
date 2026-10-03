"""Common Project Repository — CRUD operations for shared projects."""

from __future__ import annotations

import json
from datetime import datetime

import asyncpg
import structlog

from .models import CommonProject

log = structlog.get_logger(__name__)

_FIELDS = "id, author_id, title, description, project_data, created_at, updated_at"


def _from_row(r: asyncpg.Record) -> CommonProject:
    """Map database row to CommonProject domain model."""
    return CommonProject(
        id=r["id"],
        author_id=r["author_id"],
        title=r["title"],
        description=r["description"],
        project_data=json.loads(r["project_data"]) if r["project_data"] else {},
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


class CommonProjectRepo:
    """Repository for Common Project Repository operations."""

    def __init__(self, db: asyncpg.Pool):
        self.db = db

    async def list_all(self) -> list[CommonProject]:
        """List all published common projects (read-only for non-authors)."""
        rows = await self.db.fetch(
            f"SELECT {_FIELDS} FROM common_projects ORDER BY created_at DESC"
        )
        return [_from_row(r) for r in rows]

    async def get_by_id(self, project_id: str) -> CommonProject | None:
        """Get a common project by ID."""
        row = await self.db.fetchrow(
            f"SELECT {_FIELDS} FROM common_projects WHERE id = $1", project_id
        )
        return _from_row(row) if row else None

    async def create(
        self, project_id: str, author_id: str, title: str, description: str | None, project_data: dict
    ) -> CommonProject:
        """Publish a new project to Common Project Repository."""
        now = datetime.utcnow()
        await self.db.execute(
            f"INSERT INTO common_projects ({_FIELDS}) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            project_id,
            author_id,
            title,
            description,
            json.dumps(project_data),
            now,
            now,
        )
        return CommonProject(
            id=project_id,
            author_id=author_id,
            title=title,
            description=description,
            project_data=project_data,
            created_at=now,
            updated_at=now,
        )

    async def update(self, project_id: str, author_id: str, title: str, description: str | None, project_data: dict) -> CommonProject | None:
        """Update a common project (author only)."""
        now = datetime.utcnow()
        await self.db.execute(
            f"UPDATE common_projects SET title=$2, description=$3, project_data=$4, updated_at=$5 WHERE id=$1 AND author_id=$6",
            project_id,
            title,
            description,
            json.dumps(project_data),
            now,
            author_id,
        )
        return await self.get_by_id(project_id)

    async def delete(self, project_id: str, author_id: str) -> bool:
        """Delete a common project (author only)."""
        result = await self.db.execute(
            "DELETE FROM common_projects WHERE id=$1 AND author_id=$2",
            project_id,
            author_id,
        )
        return "1" in result  # asyncpg DELETE returns "DELETE N"

    async def get_by_author(self, author_id: str) -> list[CommonProject]:
        """List all projects published by a specific author."""
        rows = await self.db.fetch(
            f"SELECT {_FIELDS} FROM common_projects WHERE author_id=$1 ORDER BY created_at DESC",
            author_id,
        )
        return [_from_row(r) for r in rows]
