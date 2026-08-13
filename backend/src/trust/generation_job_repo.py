from __future__ import annotations

from .models import GenerationJob

_COLS = "id, project_id, kind, status, total, done, failed_topic_ids, created_by_sub, created_at"


def _row(r) -> GenerationJob:
    return GenerationJob(
        id=r["id"],
        project_id=r["project_id"],
        kind=r["kind"],
        status=r["status"],
        total=r["total"],
        done=r["done"],
        failed_topic_ids=list(r["failed_topic_ids"]),
        created_by_sub=r["created_by_sub"],
        created_at=r["created_at"],
    )


async def create(conn, *, project_id, total, created_by_sub) -> GenerationJob:
    r = await conn.fetchrow(
        f"""
        INSERT INTO generation_job (project_id, status, total, created_by_sub)
        VALUES ($1, 'queued', $2, $3)
        RETURNING {_COLS}
        """,
        project_id,
        total,
        created_by_sub,
    )
    return _row(r)


async def get(conn, *, job_id) -> GenerationJob | None:
    r = await conn.fetchrow(f"SELECT {_COLS} FROM generation_job WHERE id = $1", job_id)
    return _row(r) if r else None


async def update_progress(
    conn, *, job_id, done=None, status=None, add_failed_topic_id=None
) -> None:
    sets = ["updated_at = now()"]
    args: list = []

    if done is not None:
        args.append(done)
        sets.append(f"done = ${len(args)}")
    if status is not None:
        args.append(status)
        sets.append(f"status = ${len(args)}")
    if add_failed_topic_id is not None:
        args.append(add_failed_topic_id)
        sets.append(f"failed_topic_ids = array_append(failed_topic_ids, ${len(args)})")

    args.append(job_id)
    await conn.execute(
        f"UPDATE generation_job SET {', '.join(sets)} WHERE id = ${len(args)}",
        *args,
    )


async def latest_for_project(conn, *, project_id) -> GenerationJob | None:
    r = await conn.fetchrow(
        f"SELECT {_COLS} FROM generation_job WHERE project_id = $1 "
        f"ORDER BY created_at DESC LIMIT 1",
        project_id,
    )
    return _row(r) if r else None
