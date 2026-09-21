"""asyncpg data access for accounts + credential set — ADR-014 D2/D8.

Isolation is app-level: every credential operation is scoped by `account_id`, and
`account_id` is only ever obtained by looking up the verified `idp_sub` (the JWT
`sub` from a `Principal`). The backend is the single data path and already verified
the token (ticket #1), so no RLS (CLAUDE.md rule 4).

Connections are asyncpg `Connection`s acquired from the app pool by the caller.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from backend.src.accounts.models import (
    CREDENTIAL_SOURCES,
    CREDENTIAL_STATUSES,
    Account,
    Device,
    ProviderChangeLogEntry,
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
        active_provider_id=row.get("active_provider_id"),
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
        RETURNING id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at, active_provider_id
        """,
        idp_sub,
        email,
    )
    return _account(row)


async def get_account(conn: asyncpg.Connection, *, idp_sub: str) -> Account | None:
    row = await conn.fetchrow(
        "SELECT id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at, active_provider_id "
        "FROM account WHERE idp_sub = $1",
        idp_sub,
    )
    return _account(row) if row else None


async def get_account_by_id(conn: asyncpg.Connection, *, account_id: UUID) -> Account | None:
    row = await conn.fetchrow(
        "SELECT id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at, active_provider_id "
        "FROM account WHERE id = $1",
        account_id,
    )
    return _account(row) if row else None


async def list_accounts(conn: asyncpg.Connection, *, limit: int, offset: int) -> list[Account]:
    """Admin-only listing (ADR-020 D3.1), newest first. Metadata only — no keys,
    no content. Page with limit/offset; pair with count_accounts for the total."""
    rows = await conn.fetch(
        "SELECT id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at, active_provider_id "
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
        RETURNING id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at, active_provider_id
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
    """Full account purge (ADR-014 D8). provider_credential + device rows cascade."""
    result = await conn.execute("DELETE FROM account WHERE idp_sub = $1", idp_sub)
    return result != "DELETE 0"


def _device(row: asyncpg.Record) -> Device:
    return Device(
        device_id=row["device_id"],
        label=row["label"],
        platform=row["platform"],
        first_seen=row["first_seen"],
        last_seen=row["last_seen"],
    )


async def upsert_device(
    conn: asyncpg.Connection,
    *,
    account_id,
    device_id: str,
    label: str | None,
    platform: str | None,
) -> Device:
    """Register or heartbeat a device. New rows record first_seen; re-reports bump
    last_seen and refresh label/platform if newly provided (COALESCE keeps a prior
    value when the client sends null)."""
    row = await conn.fetchrow(
        """
        INSERT INTO device (account_id, device_id, label, platform)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (account_id, device_id)
            DO UPDATE SET last_seen = now(),
                          label = COALESCE(EXCLUDED.label, device.label),
                          platform = COALESCE(EXCLUDED.platform, device.platform)
        RETURNING device_id, label, platform, first_seen, last_seen
        """,
        account_id,
        device_id,
        label,
        platform,
    )
    return _device(row)


async def list_devices(conn: asyncpg.Connection, *, account_id) -> list[Device]:
    """An account's devices, most-recently-seen first (admin detail view)."""
    rows = await conn.fetch(
        "SELECT device_id, label, platform, first_seen, last_seen "
        "FROM device WHERE account_id = $1 ORDER BY last_seen DESC",
        account_id,
    )
    return [_device(r) for r in rows]


async def count_devices_by_account(
    conn: asyncpg.Connection, account_ids: list[UUID]
) -> dict[UUID, int]:
    """Device counts for a set of accounts in one query (admin list view). Accounts
    with no devices are simply absent from the map (callers default to 0)."""
    if not account_ids:
        return {}
    rows = await conn.fetch(
        "SELECT account_id, count(*) AS n FROM device "
        "WHERE account_id = ANY($1::uuid[]) GROUP BY account_id",
        account_ids,
    )
    return {r["account_id"]: int(r["n"]) for r in rows}


def _provider_change_log(row: asyncpg.Record) -> ProviderChangeLogEntry:
    return ProviderChangeLogEntry(
        id=row["id"],
        account_id=row["account_id"],
        provider_id=row["provider_id"],
        action=row["action"],
        actor_sub=row["actor_sub"],
        actor_email=row["actor_email"],
        reason=row["reason"],
        created_at=row["created_at"],
    )


async def log_provider_change(
    conn: asyncpg.Connection,
    *,
    account_id: UUID | None,
    provider_id: str,
    action: str,
    actor_sub: str | None = None,
    actor_email: str | None = None,
    reason: str | None = None,
) -> ProviderChangeLogEntry:
    """Record a provider/LLM configuration change (user-initiated or admin-triggered).
    Actions: added, removed, verified, failed, activated, deactivated."""
    row = await conn.fetchrow(
        """
        INSERT INTO provider_change_log
            (account_id, provider_id, action, actor_sub, actor_email, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, account_id, provider_id, action, actor_sub, actor_email, reason, created_at
        """,
        account_id,
        provider_id,
        action,
        actor_sub,
        actor_email,
        reason,
    )
    return _provider_change_log(row)


async def list_provider_changes(
    conn: asyncpg.Connection,
    *,
    account_id: UUID,
    limit: int = 100,
    offset: int = 0,
) -> list[ProviderChangeLogEntry]:
    """Get an account's provider change history, newest first (super-admin detail view)."""
    rows = await conn.fetch(
        """
        SELECT id, account_id, provider_id, action, actor_sub, actor_email, reason, created_at
        FROM provider_change_log
        WHERE account_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3
        """,
        account_id,
        limit,
        offset,
    )
    return [_provider_change_log(r) for r in rows]


async def set_active_provider(
    conn: asyncpg.Connection,
    *,
    idp_sub: str,
    provider_id: str | None,
) -> Account | None:
    """Set the active/selected LLM provider for an account. None to clear."""
    row = await conn.fetchrow(
        """
        UPDATE account
           SET active_provider_id = $2
         WHERE idp_sub = $1
        RETURNING id, idp_sub, email, created_at, synced_library_ref, suspended, suspended_at, active_provider_id
        """,
        idp_sub,
        provider_id,
    )
    return _account(row) if row else None
