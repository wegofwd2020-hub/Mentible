from __future__ import annotations

from .models import FEEDBACK_AUTHOR_KINDS, Feedback

_F = "id, version_id, author_kind, author_name, body, recorded_by_sub, created_at"


def _feedback(r) -> Feedback:
    return Feedback(
        **{
            k: r[k]
            for k in (
                "id",
                "version_id",
                "author_kind",
                "author_name",
                "body",
                "recorded_by_sub",
                "created_at",
            )
        }
    )


async def add_feedback(
    conn, *, version_id, author_kind, body, recorded_by_sub, author_name=None
) -> Feedback:
    if author_kind not in FEEDBACK_AUTHOR_KINDS:
        raise ValueError(f"invalid author_kind {author_kind!r}")
    r = await conn.fetchrow(
        f"INSERT INTO feedback (version_id, author_kind, author_name, body, recorded_by_sub) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_F}",
        version_id,
        author_kind,
        author_name,
        body,
        recorded_by_sub,
    )
    return _feedback(r)


async def list_feedback(conn, *, version_id) -> list[Feedback]:
    rows = await conn.fetch(
        f"SELECT {_F} FROM feedback WHERE version_id = $1 ORDER BY created_at, id",
        version_id,
    )
    return [_feedback(r) for r in rows]
