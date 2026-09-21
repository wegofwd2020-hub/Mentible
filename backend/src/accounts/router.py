"""Account API (ADR-014 ticket #3a) — the routes the Account/Settings page calls.

Every route requires a verified IdP token (`require_user`, ticket #1) and is scoped
to that principal's `idp_sub` — the backend is the single, app-isolated data path
(CLAUDE.md rule 4). The account row is provisioned lazily on first authenticated
GET (the IdP owns sign-up; we just create our minimal row, D8).
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.src.accounts import repo
from backend.src.accounts.deps import require_active_user
from backend.src.accounts.models import ProviderCredential
from backend.src.accounts.schemas import (
    AccountView,
    CredentialUpsert,
    CredentialView,
    DeviceRegister,
)
from backend.src.auth import identity_admin
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn

router = APIRouter(prefix="/api/v1/account", tags=["account"])


def _view(c: ProviderCredential) -> CredentialView:
    return CredentialView(
        provider_id=c.provider_id,
        source=c.source,
        status=c.status,
        last_verified_at=c.last_verified_at,
        updated_at=c.updated_at,
    )


@router.get("", response_model=AccountView)
async def get_my_account(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AccountView:
    """The caller's account + credential set. Lazily provisions the row on first use."""
    account = await repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
    creds = await repo.list_credentials(conn, account_id=account.id)
    return AccountView(
        sub=account.idp_sub,
        email=account.email,
        credentials=[_view(c) for c in creds],
        is_super_admin=principal.is_super_admin,
    )


@router.put("/credentials/{provider_id}", response_model=CredentialView)
async def put_credential(
    provider_id: str,
    body: CredentialUpsert,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> CredentialView:
    """Record/update custody + status for one provider. Stores NO key (D5).
    Logs the change for super-admin visibility (provider history)."""
    if (err := body.validate_enums()) is not None:
        # 422 literal — the named constant is deprecated/renamed across Starlette versions.
        raise HTTPException(status_code=422, detail=err)
    account = await repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)

    # Determine if this is a new credential or an update (for audit logging).
    existing = await repo.list_credentials(conn, account_id=account.id)
    is_new = not any(c.provider_id == provider_id for c in existing)

    cred = await repo.upsert_credential(
        conn,
        account_id=account.id,
        provider_id=provider_id,
        source=body.source,
        status=body.status,
    )

    # Log the provider change: "added" if new, "verified" if status is valid, "failed" if rejected.
    action = "added" if is_new else ("verified" if body.status == "valid" else "updated")
    await repo.log_provider_change(
        conn,
        account_id=account.id,
        provider_id=provider_id,
        action=action,
        actor_sub=principal.sub,
        actor_email=principal.email,
        reason=f"source={body.source}, status={body.status}",
    )

    return _view(cred)


@router.delete("/credentials/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    provider_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Remove a provider credential. Logs the removal for audit history."""
    account = await repo.get_account(conn, idp_sub=principal.sub)
    if account is not None:
        await repo.delete_credential(conn, account_id=account.id, provider_id=provider_id)
        # Log the removal for super-admin visibility.
        await repo.log_provider_change(
            conn,
            account_id=account.id,
            provider_id=provider_id,
            action="removed",
            actor_sub=principal.sub,
            actor_email=principal.email,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
async def register_device(
    body: DeviceRegister,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Register/heartbeat the caller's device (per-install id + label). Bumps
    last_seen; stores NO key material. Powers the admin per-user device count."""
    account = await repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
    await repo.upsert_device(
        conn,
        account_id=account.id,
        device_id=body.device_id,
        label=body.label,
        platform=body.platform,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/active-provider/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def set_active_provider(
    provider_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Set the active/selected LLM provider for generation. Logs the selection change."""
    account = await repo.get_account(conn, idp_sub=principal.sub)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no account")

    await repo.set_active_provider(conn, idp_sub=principal.sub, provider_id=provider_id)

    # Log the provider selection for audit history.
    await repo.log_provider_change(
        conn,
        account_id=account.id,
        provider_id=provider_id,
        action="activated",
        actor_sub=principal.sub,
        actor_email=principal.email,
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Full account purge (ADR-014 D8). provider_credential rows cascade. Device-local
    keys are NOT here (we never held them) — the client clears those separately.

    Also hard-deletes the Supabase auth identity when identity deletion is enabled
    (ADR-022), so the same email can re-register as a new user. Identity-first keeps
    state consistent: if the external delete fails, it raises before we drop the DB
    row (nothing is left half-deleted). When disabled it's a no-op (app-row-only)."""
    await identity_admin.delete_identity(principal.sub)
    await repo.delete_account(conn, idp_sub=principal.sub)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
