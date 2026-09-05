from __future__ import annotations

import json

from .models import INPUT_KINDS, PROJECT_STATUSES, Project, ProjectInput

_P = (
    "id, owner_account_id, title, topic, audience, goal, status, created_at, updated_at, toc, "
    "rights_attested_at, rights_holder"
)
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
                "rights_attested_at",
                "rights_holder",
            )
        },
        toc=json.loads(r["toc"]) if r["toc"] is not None else None,
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


async def update_project_toc(conn, *, project_id, toc) -> None:
    await conn.execute(
        "UPDATE project SET toc = $2::jsonb WHERE id = $1", project_id, json.dumps(toc)
    )


async def set_rights(conn, *, project_id, attested: bool, rights_holder: str | None) -> None:
    """Owner-only rights attestation (B3 Part B) — DISPLAY-ONLY, never
    referenced by any export gate. `attested=True` stamps `now()`;
    `attested=False` sets the timestamp back to null. `rights_holder` is
    ALWAYS overwritten with the caller-supplied value (null if omitted) — the
    caller must resend the current holder on every call or it is wiped."""
    await conn.execute(
        "UPDATE project SET rights_attested_at = CASE WHEN $2 THEN now() ELSE NULL END, "
        "rights_holder = $3 WHERE id = $1",
        project_id,
        attested,
        rights_holder,
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


async def add_upload_input(conn, *, project_id, title, storage_path, content_hash) -> ProjectInput:
    """Persist an uploaded binary source (e.g. an interview audio file) as a
    kind='upload' input carrying its on-disk path + content hash. Unlike
    `add_input`, this sets storage_path/content_hash (the columns text sources
    leave null)."""
    r = await conn.fetchrow(
        f"INSERT INTO project_input (project_id, kind, title, storage_path, content_hash) "
        f"VALUES ($1,'upload',$2,$3,$4) RETURNING {_I}",
        project_id,
        title,
        storage_path,
        content_hash,
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


async def delete_project(conn, *, project_id) -> None:
    """Hard-delete a project. Every child (inputs, artifacts, versions, feedback,
    approvals, memberships, invitations, topic_versions) references project with
    ON DELETE CASCADE (migrations 0009/0010), so this one statement wipes the
    whole tree. On-disk audio blobs are NOT removed (harmless orphans)."""
    await conn.execute("DELETE FROM project WHERE id = $1", project_id)


async def input_cited_by_validated(conn, *, project_id, input_id) -> bool:
    return bool(
        await conn.fetchval(
            """
        SELECT EXISTS (
          SELECT 1 FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id
          WHERE a.project_id = $1 AND v.content IS NOT NULL
            AND v.content -> 'sections' @> jsonb_build_array(
                  jsonb_build_object('source_ids', jsonb_build_array($2::text)))
            AND (SELECT ap.action FROM approval ap WHERE ap.version_id = v.id
                 ORDER BY ap.seq DESC LIMIT 1) = 'approve'
        )
        """,
            project_id,
            str(input_id),
        )
    )
