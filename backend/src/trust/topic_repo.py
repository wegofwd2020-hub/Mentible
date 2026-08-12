from __future__ import annotations

import json

from .models import TopicVersion

_TV = (
    "id, project_id, topic_id, title, source_ids, content, version_no, "
    "created_by_sub, created_at, generation_meta"
)


def _topic_version(r) -> TopicVersion:
    return TopicVersion(
        id=r["id"],
        project_id=r["project_id"],
        topic_id=r["topic_id"],
        title=r["title"],
        source_ids=json.loads(r["source_ids"]) if r["source_ids"] is not None else None,
        content=json.loads(r["content"]) if r["content"] is not None else None,
        version_no=r["version_no"],
        created_by_sub=r["created_by_sub"],
        created_at=r["created_at"],
        generation_meta=(
            json.loads(r["generation_meta"]) if r["generation_meta"] is not None else None
        ),
    )


async def create_topic_version(
    conn, *, project_id, topic_id, title, source_ids, content, created_by_sub, generation_meta=None
) -> TopicVersion:
    r = await conn.fetchrow(
        f"""
        INSERT INTO topic_version
            (project_id, topic_id, title, source_ids, content, version_no, created_by_sub,
             generation_meta)
        VALUES (
            $1, $2, $3, $4::jsonb, $5::jsonb,
            (SELECT COALESCE(MAX(version_no),0)+1 FROM topic_version
                WHERE project_id=$1 AND topic_id=$2),
            $6, $7::jsonb
        )
        RETURNING {_TV}
        """,
        project_id,
        topic_id,
        title,
        json.dumps(source_ids),
        json.dumps(content),
        created_by_sub,
        json.dumps(generation_meta) if generation_meta is not None else None,
    )
    return _topic_version(r)


async def list_topic_versions(conn, *, project_id) -> list[TopicVersion]:
    rows = await conn.fetch(
        f"SELECT {_TV} FROM topic_version WHERE project_id = $1 ORDER BY topic_id, version_no",
        project_id,
    )
    return [_topic_version(r) for r in rows]


async def get_topic_version(conn, *, topic_version_id) -> TopicVersion | None:
    r = await conn.fetchrow(f"SELECT {_TV} FROM topic_version WHERE id = $1", topic_version_id)
    return _topic_version(r) if r else None


async def project_id_for_topic_version(conn, *, topic_version_id) -> str | None:
    return await conn.fetchval(
        "SELECT project_id FROM topic_version WHERE id = $1", topic_version_id
    )
