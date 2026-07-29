from __future__ import annotations

import uuid

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from ..accounts import repo as accounts_repo
from ..accounts.deps import require_active_user
from ..accounts.models import Account
from ..auth.principal import Principal
from ..db.deps import get_conn
from . import membership_repo, schemas
from .access import ProjectAccessError, require_project_access

router = APIRouter(prefix="/api/v1/trust", tags=["trust"])


async def _account(conn: asyncpg.Connection, principal: Principal) -> Account:
    return await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )


async def _require_role(
    conn: asyncpg.Connection, account: Account, project_id: uuid.UUID, *, need_owner: bool
) -> str:
    try:
        role = await require_project_access(conn, account_id=account.id, project_id=project_id)
    except ProjectAccessError as err:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this project") from err
    if need_owner and role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")
    return role


@router.post("/session/sync", response_model=schemas.SessionSyncOut)
async def session_sync(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.SessionSyncOut:
    async with conn.transaction():
        account = await _account(conn, principal)
        memberships = (
            await membership_repo.redeem_invitations_for(
                conn, account_id=account.id, email=principal.email
            )
            if principal.email
            else []
        )
    return schemas.SessionSyncOut(
        account_id=str(account.id),
        email=account.email,
        memberships=[
            schemas.MembershipOut(project_id=str(m.project_id), role=m.role) for m in memberships
        ],
    )
