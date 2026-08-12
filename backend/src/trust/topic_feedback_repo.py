from __future__ import annotations

from .models import FEEDBACK_AUTHOR_KINDS, TopicFeedback

_TF = "id, topic_version_id, author_kind, author_name, body, recorded_by_sub, created_at"


def _topic_feedback(r) -> TopicFeedback:
    return TopicFeedback(
        **{
            k: r[k]
            for k in (
                "id",
                "topic_version_id",
                "author_kind",
                "author_name",
                "body",
                "recorded_by_sub",
                "created_at",
            )
        }
    )


async def add_topic_feedback(
    conn, *, topic_version_id, author_kind, body, recorded_by_sub, author_name=None
) -> TopicFeedback:
    if author_kind not in FEEDBACK_AUTHOR_KINDS:
        raise ValueError(f"invalid author_kind {author_kind!r}")
    r = await conn.fetchrow(
        f"INSERT INTO topic_feedback (topic_version_id, author_kind, author_name, body, recorded_by_sub) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_TF}",
        topic_version_id,
        author_kind,
        author_name,
        body,
        recorded_by_sub,
    )
    return _topic_feedback(r)


async def list_topic_feedback(conn, *, topic_version_id) -> list[TopicFeedback]:
    rows = await conn.fetch(
        # `seq` (bigserial) is the strict insertion order — created_at ties within
        # a transaction and id is a random uuid (see migration 0013 for `feedback`).
        f"SELECT {_TF} FROM topic_feedback WHERE topic_version_id = $1 ORDER BY seq",
        topic_version_id,
    )
    return [_topic_feedback(r) for r in rows]
