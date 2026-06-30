"""Admin user-management API — ADR-020 ticket #2 (D3.1).

`/api/v1/admin/users` — list / get / suspend / reactivate / delete. Every route
is gated by `require_super_admin` (D2) and returns **metadata only**: identity
reference, timestamps, suspend state, and per-provider credential source/status —
**never** key material or generated content (D5). Every mutating action is audited
(D5): actor + action + target, no secrets.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.src.accounts import repo
from backend.src.accounts.models import Account
from backend.src.accounts.schemas import (
    AdminAuditEntryView,
    AdminAuditList,
    AdminDeviceView,
    AdminUserDetail,
    AdminUserList,
    AdminUserRow,
    AdminUserSummary,
    BillingUsageSummaryView,
    CredentialView,
    EntitlementView,
    GrantEntitlementRequest,
)
from backend.src.admin import audit
from backend.src.auth import identity_admin
from backend.src.auth.deps import require_super_admin
from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans, usage_repo
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


def _detail(a: Account, creds, devices) -> AdminUserDetail:
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
        device_count=len(devices),
        devices=[
            AdminDeviceView(
                device_id=d.device_id,
                label=d.label,
                platform=d.platform,
                first_seen=d.first_seen,
                last_seen=d.last_seen,
            )
            for d in devices
        ],
    )


async def _audit(conn: asyncpg.Connection, actor: Principal, action: str, target_sub: str) -> None:
    """Record an admin action (ADR-020 D5): structlog + a durable admin_audit row.
    Actor + action + target only — never secrets. Called inside the action's
    transaction so the action and its audit row commit together."""
    logger.info(
        "admin.action",
        actor_sub=actor.sub,
        actor_email=actor.email,
        action=action,
        target_sub=target_sub,
    )
    await audit.record(
        conn,
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
    """Paginated account list, newest first. Metadata only (D3.1), plus a
    per-account device count (one grouped query, no N+1)."""
    accounts = await repo.list_accounts(conn, limit=limit, offset=offset)
    total = await repo.count_accounts(conn)
    counts = await repo.count_devices_by_account(conn, [a.id for a in accounts])
    users = [
        AdminUserRow(**_summary(a).model_dump(), device_count=counts.get(a.id, 0)) for a in accounts
    ]
    return AdminUserList(users=users, total=total, limit=limit, offset=offset)


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
    devices = await repo.list_devices(conn, account_id=account.id)
    return _detail(account, creds, devices)


@router.post("/users/{sub}/suspend", response_model=AdminUserSummary)
async def suspend_user(
    sub: str,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminUserSummary:
    async with conn.transaction():
        account = await repo.set_account_suspended(conn, idp_sub=sub, suspended=True)
        if account is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
        await _audit(conn, admin, "user.suspend", sub)
    return _summary(account)


@router.post("/users/{sub}/reactivate", response_model=AdminUserSummary)
async def reactivate_user(
    sub: str,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminUserSummary:
    async with conn.transaction():
        account = await repo.set_account_suspended(conn, idp_sub=sub, suspended=False)
        if account is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
        await _audit(conn, admin, "user.reactivate", sub)
    return _summary(account)


@router.delete("/users/{sub}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    sub: str,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Full account purge (credentials cascade). 404 if unknown. Audited.

    The audit row outlives the account (no FK), so the delete stays attributable.
    Also hard-deletes the Supabase auth identity when enabled (ADR-022), so the
    user can re-register fresh; a no-op when disabled (app-row-only purge). We
    confirm the user exists, then delete the identity before the DB row so a failed
    external delete (raised) leaves nothing half-deleted."""
    if await repo.get_account(conn, idp_sub=sub) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
    await identity_admin.delete_identity(sub)
    async with conn.transaction():
        await repo.delete_account(conn, idp_sub=sub)
        await _audit(conn, admin, "user.delete", sub)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users/{sub}/entitlement", response_model=EntitlementView | None)
async def get_entitlement(
    sub: str,
    _admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> EntitlementView | None:
    """The account's managed entitlement, or null if none. 404 if the user is unknown."""
    account = await repo.get_account(conn, idp_sub=sub)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")
    ent = await entitlement_repo.get_entitlement(conn, account_id=account.id)
    if ent is None:
        return None
    return EntitlementView(
        plan_id=ent.plan_id,
        status=ent.status,
        period_start=ent.period_start,
        period_end=ent.period_end,
    )


@router.put("/users/{sub}/entitlement", response_model=EntitlementView)
async def grant_entitlement(
    sub: str,
    body: GrantEntitlementRequest,
    admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> EntitlementView:
    """Grant/replace an account's managed plan (ADR-005 D6, Phase 3 — no payments yet).

    Validates the plan id and status; the period runs from now for `period_days` (else
    the plan's window). 404 if the user is unknown, 422 on an unknown plan/status. Audited."""
    plan = plans.get_plan(body.plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown plan_id; known: {sorted(plans.plan_ids())}",
        )
    if body.status not in entitlement_repo.ENTITLEMENT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status must be one of {entitlement_repo.ENTITLEMENT_STATUSES}",
        )
    account = await repo.get_account(conn, idp_sub=sub)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such user")

    now = datetime.now(UTC)
    period_end = now + timedelta(days=body.period_days or plan.window_days)
    async with conn.transaction():
        ent = await entitlement_repo.set_entitlement(
            conn,
            account_id=account.id,
            plan_id=plan.id,
            status=body.status,
            period_start=now,
            period_end=period_end,
        )
        await _audit(conn, admin, f"entitlement.set:{plan.id}:{body.status}", sub)
    return EntitlementView(
        plan_id=ent.plan_id,
        status=ent.status,
        period_start=ent.period_start,
        period_end=ent.period_end,
    )


@router.get("/billing/usage-summary", response_model=BillingUsageSummaryView)
async def billing_usage_summary(
    days: int = Query(default=30, ge=1, le=366),
    _admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> BillingUsageSummaryView:
    """Aggregate managed spend across all accounts over the last `days` (margin monitoring,
    Phase 6). Read-only; metadata only — totals, not per-user content."""
    since = datetime.now(UTC) - timedelta(days=days)
    total = await usage_repo.total_usage(conn, since=since)
    return BillingUsageSummaryView(
        window_days=days,
        cost_micros=total.cost_micros,
        events=total.events,
        accounts=total.accounts,
    )


@router.get("/audit", response_model=AdminAuditList)
async def list_audit(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Principal = Depends(require_super_admin),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AdminAuditList:
    """The persisted admin-action trail (ADR-020 D5), newest first."""
    entries = await audit.list_entries(conn, limit=limit, offset=offset)
    total = await audit.count_entries(conn)
    return AdminAuditList(
        entries=[
            AdminAuditEntryView(
                actor_sub=e.actor_sub,
                actor_email=e.actor_email,
                action=e.action,
                target_sub=e.target_sub,
                created_at=e.created_at,
            )
            for e in entries
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
