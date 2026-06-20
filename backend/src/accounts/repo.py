"""asyncpg data access for accounts + credential set — ADR-014 D2/D8.

Isolation is app-level: every credential operation is scoped by `account_id`, and
`account_id` is only ever obtained by looking up the verified `idp_sub` (the JWT
`sub` from a `Principal`). The backend is the single data path and already verified
the token (ticket #1), so no RLS (CLAUDE.md rule 4).

Connections are asyncpg `Connection`s acquired from the app pool by the caller.
"""

from __future__ import annotations

import asyncpg

from backend.src.accounts.models import (
    CREDENTIAL_SOURCES,
    CREDENTIAL_STATUSES,
    Account,
    ProviderCredential,
)

# Every account read returns this column set (kept identical across queries so the
# suspend fields, ADR-020, surface everywhere). Inlined as literals per query —
# not interpolated — to keep the SQL injection-proof by construction (ruff S608).


def _account(row: asyncpg.Record) -> Account:
    return Account(
        id=row["id"],
        idp_sub=row["idp_sub"],
        email=row["email"],
        created_at=row["created_at"],
        synced_library_ref=row["synced_library_ref"],
        suspended=row["suspended"],
        suspended_at=row["suspended_at"],
    )


def _credential(row: asyncpg.Record) -> ProviderCredential:
    return ProviderCredential(
        provider_id=row["provider_id"],
        source=row["source"],
        status=row["status"],
        last_verified_at=row["last_verified_at"],
        updated_at=row["updated_at"],
    )


async def get_or_create_account(
    conn: asyncpg.Connection, *, idp_sub: str, email: str | None
) -> Account:
    """Idempotent on `idp_sub`. A later login with no email won't clobber a stored one."""
    row = await conn.fetchrow(
        """
        INSERT INTO account (idp_sub, email) VALUES ($1, $2)
        ON CONFLICT (idp_sub)
            DO UPDATE SET email = COALESCE(EXCLUDED.email, account.email)
        RETURNING id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at
        """,
        idp_sub,
        email,
    )
    return _account(row)


async def get_account(conn: asyncpg.Connection, *, idp_sub: str) -> Account | None:
    row = await conn.fetchrow(
        "SELECT id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at "
        "FROM account WHERE idp_sub = $1",
        idp_sub,
    )
    return _account(row) if row else None


async def list_accounts(conn: asyncpg.Connection, *, limit: int, offset: int) -> list[Account]:
    """Admin-only listing (ADR-020 D3.1), newest first. Metadata only — no keys,
    no content. Page with limit/offset; pair with count_accounts for the total."""
    rows = await conn.fetch(
        "SELECT id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at "
        "FROM account ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit,
        offset,
    )
    return [_account(r) for r in rows]


async def count_accounts(conn: asyncpg.Connection) -> int:
    return int(await conn.fetchval("SELECT count(*) FROM account"))


async def set_account_suspended(
    conn: asyncpg.Connection, *, idp_sub: str, suspended: bool
) -> Account | None:
    """Suspend/reactivate an account (ADR-020 D3.1). Sets suspended_at on suspend,
    clears it on reactivate. Returns the updated account, or None if no such account."""
    row = await conn.fetchrow(
        """
        UPDATE account
           SET suspended = $2,
               suspended_at = CASE WHEN $2 THEN now() ELSE NULL END
         WHERE idp_sub = $1
        RETURNING id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at
        """,
        idp_sub,
        suspended,
    )
    return _account(row) if row else None


async def list_credentials(conn: asyncpg.Connection, *, account_id) -> list[ProviderCredential]:
    rows = await conn.fetch(
        "SELECT provider_id, source, status, last_verified_at, updated_at "
        "FROM provider_credential WHERE account_id = $1 ORDER BY provider_id",
        account_id,
    )
    return [_credential(r) for r in rows]


async def upsert_credential(
    conn: asyncpg.Connection,
    *,
    account_id,
    provider_id: str,
    source: str,
    status: str = "unverified",
) -> ProviderCredential:
    if source not in CREDENTIAL_SOURCES:
        raise ValueError(f"unknown credential source: {source!r}")
    if status not in CREDENTIAL_STATUSES:
        raise ValueError(f"unknown credential status: {status!r}")
    row = await conn.fetchrow(
        """
        INSERT INTO provider_credential (account_id, provider_id, source, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (account_id, provider_id)
            DO UPDATE SET source = EXCLUDED.source,
                          status = EXCLUDED.status,
                          updated_at = now()
        RETURNING provider_id, source, status, last_verified_at, updated_at
        """,
        account_id,
        provider_id,
        source,
        status,
    )
    return _credential(row)


async def delete_credential(conn: asyncpg.Connection, *, account_id, provider_id: str) -> bool:
    result = await conn.execute(
        "DELETE FROM provider_credential WHERE account_id = $1 AND provider_id = $2",
        account_id,
        provider_id,
    )
    return result != "DELETE 0"


async def delete_account(conn: asyncpg.Connection, *, idp_sub: str) -> bool:
    """Full account purge (ADR-014 D8). provider_credential rows cascade."""
    result = await conn.execute("DELETE FROM account WHERE idp_sub = $1", idp_sub)
    return result != "DELETE 0"
