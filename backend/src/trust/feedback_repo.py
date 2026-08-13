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
        # `seq` (bigserial) is the strict insertion order — created_at ties within
        # a transaction and id is a random uuid (see migration 0013).
        f"SELECT {_F} FROM feedback WHERE version_id = $1 ORDER BY seq",
        version_id,
    )
    return [_feedback(r) for r in rows]


async def list_project_feedback(conn, *, project_id) -> list[dict]:
    """Project-wide revision-notes rollup — every `feedback` (artifact-version)
    and `topic_feedback` (topic-version) note across the project, newest first.
    Shaped directly for `schemas.ProjectFeedbackItemOut`; read-only, no writes."""
    rows = await conn.fetch(
        """
        SELECT 'artifact' AS source, COALESCE(a.title, a.format) AS draft_label,
               a.format AS format, v.version_no AS version_no,
               f.author_kind, f.author_name, f.body, f.created_at
          FROM feedback f
          JOIN artifact_version v ON f.version_id = v.id
          JOIN artifact a ON v.artifact_id = a.id
         WHERE a.project_id = $1
        UNION ALL
        SELECT 'topic' AS source, tv.title AS draft_label,
               NULL AS format, tv.version_no AS version_no,
               tf.author_kind, tf.author_name, tf.body, tf.created_at
          FROM topic_feedback tf
          JOIN topic_version tv ON tf.topic_version_id = tv.id
         WHERE tv.project_id = $1
        ORDER BY created_at DESC, draft_label
        """,
        project_id,
    )
    return [dict(r) for r in rows]
