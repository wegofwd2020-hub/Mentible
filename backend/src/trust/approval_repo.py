"""Append-only expert-approval records (ADR-037 D4).

A version is 'expert validated' IFF an approval row exists for it. There is
deliberately NO update or delete path — approval is immutable trust evidence.
"""

from __future__ import annotations

from .models import APPROVAL_VIA, Approval

_AP = (
    "id, version_id, expert_name, expert_email, expert_role, "
    "approved_at, recorded_by_sub, recorded_at, note, recorded_via"
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
) -> Approval:
    if recorded_via not in APPROVAL_VIA:
        raise ValueError(f"invalid recorded_via {recorded_via!r}")
    r = await conn.fetchrow(
        f"INSERT INTO approval (version_id, expert_name, expert_email, expert_role, "
        f"approved_at, recorded_by_sub, note, recorded_via) "
        f"VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING {_AP}",
        version_id,
        expert_name,
        expert_email,
        expert_role,
        approved_at,
        recorded_by_sub,
        note,
        recorded_via,
    )
    return _approval(r)


async def get_approval(conn, *, version_id) -> Approval | None:
    r = await conn.fetchrow(
        f"SELECT {_AP} FROM approval WHERE version_id = $1 "
        f"ORDER BY recorded_at DESC, id DESC LIMIT 1",
        version_id,
    )
    return _approval(r) if r else None


async def is_validated(conn, *, version_id) -> bool:
    return bool(
        await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM approval WHERE version_id = $1)", version_id
        )
    )
