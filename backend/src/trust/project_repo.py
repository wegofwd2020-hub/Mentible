from __future__ import annotations

from .models import INPUT_KINDS, PROJECT_STATUSES, Project, ProjectInput

_P = "id, owner_account_id, title, topic, audience, goal, status, created_at, updated_at"
_I = "id, project_id, kind, title, content, source_ref, storage_path, content_hash, created_at"


def _project(r) -> Project:
    return Project(
        **{
            k: r[k]
            for k in (
                "id",
                "owner_account_id",
                "title",
                "topic",
                "audience",
                "goal",
                "status",
                "created_at",
                "updated_at",
            )
        }
    )


def _input(r) -> ProjectInput:
    return ProjectInput(
        **{
            k: r[k]
            for k in (
                "id",
                "project_id",
                "kind",
                "title",
                "content",
                "source_ref",
                "storage_path",
                "content_hash",
                "created_at",
            )
        }
    )


async def create_project(
    conn, *, owner_account_id, title, topic=None, audience=None, goal=None
) -> Project:
    r = await conn.fetchrow(
        f"INSERT INTO project (owner_account_id, title, topic, audience, goal) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_P}",
        owner_account_id,
        title,
        topic,
        audience,
        goal,
    )
    return _project(r)


async def get_project(conn, *, project_id) -> Project | None:
    r = await conn.fetchrow(f"SELECT {_P} FROM project WHERE id = $1", project_id)
    return _project(r) if r else None


async def list_projects(conn, *, owner_account_id) -> list[Project]:
    rows = await conn.fetch(
        f"SELECT {_P} FROM project WHERE owner_account_id = $1 ORDER BY created_at DESC, id DESC",
        owner_account_id,
    )
    return [_project(r) for r in rows]


async def set_status(conn, *, project_id, status) -> None:
    if status not in PROJECT_STATUSES:
        raise ValueError(f"invalid status {status!r}")
    await conn.execute(
        "UPDATE project SET status = $2, updated_at = now() WHERE id = $1",
        project_id,
        status,
    )


async def add_input(
    conn, *, project_id, kind, title=None, content=None, source_ref=None
) -> ProjectInput:
    if kind not in INPUT_KINDS:
        raise ValueError(f"invalid kind {kind!r}")
    r = await conn.fetchrow(
        f"INSERT INTO project_input (project_id, kind, title, content, source_ref) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_I}",
        project_id,
        kind,
        title,
        content,
        source_ref,
    )
    return _input(r)


async def list_inputs(conn, *, project_id) -> list[ProjectInput]:
    rows = await conn.fetch(
        f"SELECT {_I} FROM project_input WHERE project_id = $1 ORDER BY created_at, id",
        project_id,
    )
    return [_input(r) for r in rows]


async def get_input(conn, *, input_id) -> ProjectInput | None:
    r = await conn.fetchrow(f"SELECT {_I} FROM project_input WHERE id = $1", input_id)
    return _input(r) if r else None


async def update_input(conn, *, input_id, title, content, source_ref) -> ProjectInput:
    r = await conn.fetchrow(
        f"UPDATE project_input SET title=$2, content=$3, source_ref=$4 WHERE id=$1 RETURNING {_I}",
        input_id,
        title,
        content,
        source_ref,
    )
    return _input(r)


async def delete_input(conn, *, input_id) -> None:
    await conn.execute("DELETE FROM project_input WHERE id = $1", input_id)


async def input_cited(conn, *, project_id, input_id) -> bool:
    return bool(
        await conn.fetchval(
            """
        SELECT EXISTS (
          SELECT 1 FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id
          WHERE a.project_id = $1 AND v.content IS NOT NULL
            AND v.content -> 'sections' @> jsonb_build_array(
                  jsonb_build_object('source_ids', jsonb_build_array($2::text)))
        )
        """,
            project_id,
            str(input_id),
        )
    )
