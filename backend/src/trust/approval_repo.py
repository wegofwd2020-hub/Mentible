"""Append-only expert-approval records (ADR-037 D4).

A version is 'expert validated' IFF its LATEST approval row is an 'approve'
(vs a 'withdraw'). There is deliberately NO update or delete path — approval is
immutable trust evidence; an approval is revoked by APPENDING a 'withdraw' row,
never by mutating or removing the original 'approve'.
"""

from __future__ import annotations

from .models import APPROVAL_ACTION, APPROVAL_VIA, Approval

_AP = (
    "id, version_id, expert_name, expert_email, expert_role, "
    "approved_at, recorded_by_sub, recorded_at, note, recorded_via, action"
)


def _approval(r) -> Approval:
    return Approval(
        **{
            k: r[k]
            for k in (
                "id",
                "version_id",
                "expert_name",
                "expert_email",
                "expert_role",
                "approved_at",
                "recorded_by_sub",
                "recorded_at",
                "note",
                "recorded_via",
                "action",
            )
        }
    )


async def record_approval(
    conn,
    *,
    version_id,
    expert_name,
    approved_at,
    recorded_by_sub,
    expert_email=None,
    expert_role=None,
    note=None,
    recorded_via="operator",
    action="approve",
) -> Approval:
    if recorded_via not in APPROVAL_VIA:
        raise ValueError(f"invalid recorded_via {recorded_via!r}")
    if action not in APPROVAL_ACTION:
        raise ValueError(f"invalid action {action!r}")
    r = await conn.fetchrow(
        f"INSERT INTO approval (version_id, expert_name, expert_email, expert_role, "
        f"approved_at, recorded_by_sub, note, recorded_via, action) "
        f"VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING {_AP}",
        version_id,
        expert_name,
        expert_email,
        expert_role,
        approved_at,
        recorded_by_sub,
        note,
        recorded_via,
        action,
    )
    return _approval(r)


async def withdraw_approval(
    conn,
    *,
    version_id,
    recorded_by_sub,
    recorded_via="operator",
    note=None,
) -> Approval | None:
    """Revoke the current approval by appending a 'withdraw' row that carries the
    same expert identity as the approval it revokes. Returns None (no-op) if the
    version is not currently validated — nothing to withdraw."""
    latest = await get_approval(conn, version_id=version_id)
    if latest is None or latest.action != "approve":
        return None
    return await record_approval(
        conn,
        version_id=version_id,
        expert_name=latest.expert_name,
        approved_at=latest.approved_at,
        recorded_by_sub=recorded_by_sub,
        expert_email=latest.expert_email,
        expert_role=latest.expert_role,
        note=note,
        recorded_via=recorded_via,
        action="withdraw",
    )


async def get_approval(conn, *, version_id) -> Approval | None:
    r = await conn.fetchrow(
        f"SELECT {_AP} FROM approval WHERE version_id = $1 "
        f"ORDER BY recorded_at DESC, id DESC LIMIT 1",
        version_id,
    )
    return _approval(r) if r else None


async def is_validated(conn, *, version_id) -> bool:
    latest = await get_approval(conn, version_id=version_id)
    return latest is not None and latest.action == "approve"
