"""Admin user-management API — ADR-020 ticket #2 (D3.1).

`/api/v1/admin/users` — list / get / suspend / reactivate / delete. Every route
is gated by `require_super_admin` (D2) and returns **metadata only**: identity
reference, timestamps, suspend state, and per-provider credential source/status —
**never** key material or generated content (D5). Every mutating action is audited
(D5): actor + action + target, no secrets.
"""

from __future__ import annotations

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.src.accounts import repo
from backend.src.accounts.models import Account
from backend.src.accounts.schemas import (
    AdminUserDetail,
    AdminUserList,
    AdminUserSummary,
    CredentialView,
)
from backend.src.auth.deps import require_super_admin
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

logger = structlog.get_logger(__name__)


def _summary(a: Account) -> AdminUserSummary:
    return AdminUserSummary(
        sub=a.idp_sub,
        email=a.email,
        created_at=a.created_at,
        suspended=a.suspended,
        suspended_at=a.suspended_at,
    )


def _detail(a: Account, creds) -> AdminUserDetail:
    return AdminUserDetail(
        **_summary(a).model_dump(),
        credentials=[
            CredentialView(
                provider_id=c.provider_id,
                source=c.source,
                status=c.status,
                last_verified_at=c.last_verified_at,
                updated_at=c.updated_at,
            )
            for c in creds
        ],
    )


def _audit(actor: Principal, action: str, target_sub: str) -> None:
    """Record an admin action (ADR-020 D5). Actor + action + target only — no secrets."""
    logger.info(
        "admin.action",
        actor_sub=actor.sub,
        actor_email=actor.email,
        action=action,
        target_sub=target_sub,
    )


@router.get("/users", response_model=AdminUserList)
async def list_users(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminUserList:
    """Paginated account list, newest first. Metadata only (D3.1)."""
    accounts = await repo.list_accounts(conn, limit=limit, offset=offset)
    total = await repo.count_accounts(conn)
    return AdminUserList(
        users=[_summary(a) for a in accounts], total=total, limit=limit, offset=offset
    )


@router.get("/users/{sub}", response_model=AdminUserDetail)
async def get_user(
    sub: str,
    _admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminUserDetail:
    """One account + its credential-set metadata. 404 if unknown."""
    account = await repo.get_account(conn, idp_sub=sub)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
    creds = await repo.list_credentials(conn, account_id=account.id)
    return _detail(account, creds)


@router.post("/users/{sub}/suspend", response_model=AdminUserSummary)
async def suspend_user(
    sub: str,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminUserSummary:
    account = await repo.set_account_suspended(conn, idp_sub=sub, suspended=True)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
    _audit(admin, "user.suspend", sub)
    return _summary(account)


@router.post("/users/{sub}/reactivate", response_model=AdminUserSummary)
async def reactivate_user(
    sub: str,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminUserSummary:
    account = await repo.set_account_suspended(conn, idp_sub=sub, suspended=False)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
    _audit(admin, "user.reactivate", sub)
    return _summary(account)


@router.delete("/users/{sub}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    sub: str,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Full account purge (credentials cascade). 404 if unknown. Audited."""
    deleted = await repo.delete_account(conn, idp_sub=sub)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
    _audit(admin, "user.delete", sub)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
