from __future__ import annotations

from .models import INVITE_ROLES, Invitation, Membership

_INV = "id, project_id, invited_email, role, invited_by_sub, created_at, revoked_at"
_MEM = "project_id, account_id, role, created_at"


def _invitation(r) -> Invitation:
    return Invitation(
        **{
            k: r[k]
            for k in (
                "id",
                "project_id",
                "invited_email",
                "role",
                "invited_by_sub",
                "created_at",
                "revoked_at",
            )
        }
    )


def _membership(r) -> Membership:
    return Membership(**{k: r[k] for k in ("project_id", "account_id", "role", "created_at")})


async def invite(conn, *, project_id, email, invited_by_sub, role="reviewer") -> Invitation:
    if role not in INVITE_ROLES:
        raise ValueError(f"invalid invite role {role!r}")
    r = await conn.fetchrow(
        f"INSERT INTO project_invitation (project_id, invited_email, role, invited_by_sub) "
        f"VALUES ($1,$2,$3,$4) "
        f"ON CONFLICT (project_id, invited_email) DO UPDATE SET "
        f"revoked_at = NULL, invited_by_sub = EXCLUDED.invited_by_sub, role = EXCLUDED.role "
        f"RETURNING {_INV}",
        project_id,
        email.lower(),
        role,
        invited_by_sub,
    )
    return _invitation(r)


async def revoke(conn, *, project_id, email) -> bool:
    """Stop future redeems for this email. Returns True if an active invite was
    revoked; False if there was no active invite (already revoked or never sent)."""
    row = await conn.fetchrow(
        "UPDATE project_invitation SET revoked_at = now() "
        "WHERE project_id = $1 AND invited_email = $2 AND revoked_at IS NULL "
        "RETURNING id",
        project_id,
        email.lower(),
    )
    return row is not None


async def remove_member(conn, *, project_id, email) -> bool:
    """Delete the materialized membership for the account registered under this
    email. Returns True if a membership row was removed. Access is decided per
    request by `require_project_access`, so removal takes effect immediately."""
    row = await conn.fetchrow(
        "DELETE FROM project_membership pm USING account a "
        "WHERE pm.account_id = a.id AND pm.project_id = $1 AND lower(a.email) = $2 "
        "RETURNING pm.account_id",
        project_id,
        email.lower(),
    )
    return row is not None


async def list_invitations(conn, *, project_id) -> list[Invitation]:
    rows = await conn.fetch(
        f"SELECT {_INV} FROM project_invitation WHERE project_id = $1 ORDER BY created_at, id",
        project_id,
    )
    return [_invitation(r) for r in rows]


async def list_members(conn, *, project_id) -> list[Membership]:
    rows = await conn.fetch(
        f"SELECT {_MEM} FROM project_membership WHERE project_id = $1 "
        f"ORDER BY created_at, account_id",
        project_id,
    )
    return [_membership(r) for r in rows]


async def redeem_invitations_for(conn, *, account_id, email) -> list[Membership]:
    """Materialize memberships for every active invite matching this email.
    The login hook (wiring deferred — no trust router yet)."""
    invited = await conn.fetch(
        "SELECT project_id, role FROM project_invitation "
        "WHERE invited_email = $1 AND revoked_at IS NULL",
        email.lower(),
    )
    for row in invited:
        await conn.execute(
            "INSERT INTO project_membership (project_id, account_id, role) "
            "VALUES ($1,$2,$3) ON CONFLICT (project_id, account_id) DO NOTHING",
            row["project_id"],
            account_id,
            row["role"],
        )
    if not invited:
        return []
    project_ids = [row["project_id"] for row in invited]
    rows = await conn.fetch(
        f"SELECT {_MEM} FROM project_membership "
        f"WHERE account_id = $1 AND project_id = ANY($2::uuid[]) "
        f"ORDER BY created_at, project_id",
        account_id,
        project_ids,
    )
    return [_membership(r) for r in rows]
