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
from backend.src.accounts.schemas import AccountView, CredentialUpsert, CredentialView
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
    )


@router.put("/credentials/{provider_id}", response_model=CredentialView)
async def put_credential(
    provider_id: str,
    body: CredentialUpsert,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> CredentialView:
    """Record/update custody + status for one provider. Stores NO key (D5)."""
    if (err := body.validate_enums()) is not None:
        # 422 literal — the named constant is deprecated/renamed across Starlette versions.
        raise HTTPException(status_code=422, detail=err)
    account = await repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
    cred = await repo.upsert_credential(
        conn,
        account_id=account.id,
        provider_id=provider_id,
        source=body.source,
        status=body.status,
    )
    return _view(cred)


@router.delete("/credentials/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    provider_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    account = await repo.get_account(conn, idp_sub=principal.sub)
    if account is not None:
        await repo.delete_credential(conn, account_id=account.id, provider_id=provider_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Full account purge (ADR-014 D8). provider_credential rows cascade. Device-local
    keys are NOT here (we never held them) — the client clears those separately."""
    await repo.delete_account(conn, idp_sub=principal.sub)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
