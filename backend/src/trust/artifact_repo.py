from __future__ import annotations

import json

from .models import (
    ARTIFACT_FORMATS,
    ARTIFACT_ROLES,
    Artifact,
    ArtifactVersion,
)

_A = "id, project_id, role, format, title, created_at, updated_at"
_V = "id, artifact_id, version_no, content, generation_meta, created_by_sub, created_at"


def _artifact(r) -> Artifact:
    return Artifact(
        **{
            k: r[k]
            for k in ("id", "project_id", "role", "format", "title", "created_at", "updated_at")
        }
    )


def _version(r) -> ArtifactVersion:
    return ArtifactVersion(
        id=r["id"],
        artifact_id=r["artifact_id"],
        version_no=r["version_no"],
        content=json.loads(r["content"]) if r["content"] is not None else None,
        generation_meta=(
            json.loads(r["generation_meta"]) if r["generation_meta"] is not None else None
        ),
        created_by_sub=r["created_by_sub"],
        created_at=r["created_at"],
    )


async def create_artifact(conn, *, project_id, role, format, title=None) -> Artifact:
    if role not in ARTIFACT_ROLES:
        raise ValueError(f"invalid role {role!r}")
    if format not in ARTIFACT_FORMATS:
        raise ValueError(f"invalid format {format!r}")
    r = await conn.fetchrow(
        f"INSERT INTO artifact (project_id, role, format, title) "
        f"VALUES ($1,$2,$3,$4) RETURNING {_A}",
        project_id,
        role,
        format,
        title,
    )
    return _artifact(r)


async def list_artifacts(conn, *, project_id) -> list[Artifact]:
    rows = await conn.fetch(
        f"SELECT {_A} FROM artifact WHERE project_id = $1 ORDER BY created_at, id",
        project_id,
    )
    return [_artifact(r) for r in rows]


async def create_version(
    conn, *, artifact_id, content, created_by_sub, generation_meta=None
) -> ArtifactVersion:
    r = await conn.fetchrow(
        f"""
        INSERT INTO artifact_version
            (artifact_id, version_no, content, generation_meta, created_by_sub)
        VALUES (
            $1,
            (SELECT COALESCE(MAX(version_no),0)+1 FROM artifact_version WHERE artifact_id=$1),
            $2::jsonb, $3::jsonb, $4
        )
        RETURNING {_V}
        """,
        artifact_id,
        json.dumps(content),
        json.dumps(generation_meta) if generation_meta is not None else None,
        created_by_sub,
    )
    return _version(r)


async def list_versions(conn, *, artifact_id) -> list[ArtifactVersion]:
    rows = await conn.fetch(
        f"SELECT {_V} FROM artifact_version WHERE artifact_id = $1 ORDER BY version_no",
        artifact_id,
    )
    return [_version(r) for r in rows]


async def add_version_sources(conn, *, version_id, input_ids) -> None:
    for input_id in input_ids:
        await conn.execute(
            "INSERT INTO artifact_version_source (version_id, input_id) "
            "VALUES ($1,$2) ON CONFLICT DO NOTHING",
            version_id,
            input_id,
        )


async def list_version_sources(conn, *, version_id) -> list[str]:
    rows = await conn.fetch(
        "SELECT input_id FROM artifact_version_source WHERE version_id = $1 ORDER BY input_id",
        version_id,
    )
    return [str(r["input_id"]) for r in rows]
