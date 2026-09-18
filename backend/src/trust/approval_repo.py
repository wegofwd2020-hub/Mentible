"""Append-only expert-approval records (ADR-037 D4).

A version is 'expert validated' IFF its LATEST approval row is an 'approve'
(vs a 'withdraw'). There is deliberately NO update or delete path — approval is
immutable trust evidence; an approval is revoked by APPENDING a 'withdraw' row,
never by mutating or removing the original 'approve'.
"""

from __future__ import annotations

import asyncpg
import structlog

from backend.src.analytics import repo as analytics_repo
from backend.src.analytics.models import DeviceClass, EventName
from backend.src.analytics.schemas import EventIn

from .models import APPROVAL_ACTION, APPROVAL_VIA, Approval

log = structlog.get_logger(__name__)

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
    approval = _approval(r)

    # Record review_completed event for approve/withdraw actions (best-effort).
    if action in ("approve", "withdraw"):
        try:
            # Map action to review_status: approve → approved, withdraw → revoked
            review_status = "approved" if action == "approve" else "revoked"

            # Get the account to associate with the event.
            account_row = await conn.fetchrow(
                "SELECT id FROM account WHERE idp_sub = $1", recorded_by_sub
            )
            if account_row:
                event = EventIn(
                    event_name=EventName.REVIEW_COMPLETED,
                    session_id=str(version_id),
                    device_class=DeviceClass.DESKTOP,
                    properties={
                        "review_status": review_status,
                        "review_duration_ms": 0,  # Not tracked client-side; placeholder
                    },
                )
                await analytics_repo.record_event(conn, event=event, user_id=account_row["id"])
        except Exception as e:
            log.warning(
                "analytics_review_completed_event_failed",
                version_id=str(version_id),
                action=action,
                error=str(e),
            )

    return approval


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
        # `seq` (bigserial) is the only strictly-monotonic insertion order —
        # recorded_at ties within a transaction and id is a random uuid.
        f"SELECT {_AP} FROM approval WHERE version_id = $1 ORDER BY seq DESC LIMIT 1",
        version_id,
    )
    return _approval(r) if r else None


async def is_validated(conn, *, version_id) -> bool:
    latest = await get_approval(conn, version_id=version_id)
    return latest is not None and latest.action == "approve"
