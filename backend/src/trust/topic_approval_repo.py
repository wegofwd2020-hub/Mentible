"""Append-only expert-approval records for per-topic drafts (Slice C1).

Mirrors `approval_repo.py` (ADR-037 D4) at the topic-version grain: a topic
version is 'expert validated' IFF its LATEST approval row is an 'approve' (vs
a 'withdraw'). No update or delete path — approval is immutable trust
evidence; an approval is revoked by APPENDING a 'withdraw' row.
"""

from __future__ import annotations

from .models import APPROVAL_ACTION, APPROVAL_VIA, TopicApproval

_TAP = (
    "id, topic_version_id, seq, action, expert_name, expert_email, expert_role, "
    "approved_at, recorded_by_sub, note, recorded_via, recorded_at"
)


def _topic_approval(r) -> TopicApproval:
    return TopicApproval(
        **{
            k: r[k]
            for k in (
                "id",
                "topic_version_id",
                "seq",
                "action",
                "expert_name",
                "expert_email",
                "expert_role",
                "approved_at",
                "recorded_by_sub",
                "note",
                "recorded_via",
                "recorded_at",
            )
        }
    )


async def record_topic_approval(
    conn,
    *,
    topic_version_id,
    expert_name,
    approved_at,
    recorded_by_sub,
    expert_email=None,
    expert_role=None,
    note=None,
    recorded_via="operator",
    action="approve",
) -> TopicApproval:
    if recorded_via not in APPROVAL_VIA:
        raise ValueError(f"invalid recorded_via {recorded_via!r}")
    if action not in APPROVAL_ACTION:
        raise ValueError(f"invalid action {action!r}")
    r = await conn.fetchrow(
        f"INSERT INTO topic_approval (topic_version_id, action, expert_name, expert_email, "
        f"expert_role, approved_at, recorded_by_sub, note, recorded_via) "
        f"VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING {_TAP}",
        topic_version_id,
        action,
        expert_name,
        expert_email,
        expert_role,
        approved_at,
        recorded_by_sub,
        note,
        recorded_via,
    )
    return _topic_approval(r)


async def withdraw_topic_approval(
    conn,
    *,
    topic_version_id,
    recorded_by_sub,
    recorded_via="operator",
    note=None,
) -> TopicApproval | None:
    """Revoke the current approval by appending a 'withdraw' row that carries the
    same expert identity as the approval it revokes. Returns None (no-op) if the
    topic version is not currently validated — nothing to withdraw."""
    latest = await get_latest_topic_approval(conn, topic_version_id=topic_version_id)
    if latest is None or latest.action != "approve":
        return None
    return await record_topic_approval(
        conn,
        topic_version_id=topic_version_id,
        expert_name=latest.expert_name,
        approved_at=latest.approved_at,
        recorded_by_sub=recorded_by_sub,
        expert_email=latest.expert_email,
        expert_role=latest.expert_role,
        note=note,
        recorded_via=recorded_via,
        action="withdraw",
    )


async def get_latest_topic_approval(conn, *, topic_version_id) -> TopicApproval | None:
    r = await conn.fetchrow(
        # `seq` (bigserial) is the only strictly-monotonic insertion order —
        # recorded_at ties within a transaction and id is a random uuid.
        f"SELECT {_TAP} FROM topic_approval WHERE topic_version_id = $1 ORDER BY seq DESC LIMIT 1",
        topic_version_id,
    )
    return _topic_approval(r) if r else None


async def is_topic_validated(conn, *, topic_version_id) -> bool:
    latest = await get_latest_topic_approval(conn, topic_version_id=topic_version_id)
    return latest is not None and latest.action == "approve"
