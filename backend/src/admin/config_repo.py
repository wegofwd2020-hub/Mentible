"""System config repository — read/write runtime settings."""

from __future__ import annotations

import asyncpg


async def get_config(conn: asyncpg.Connection, key: str) -> str | None:
    """Fetch a config value by key. Returns None if not found."""
    row = await conn.fetchrow(
        "SELECT value FROM system_config WHERE key = $1",
        key,
    )
    return row["value"] if row else None


async def set_config(
    conn: asyncpg.Connection,
    key: str,
    value: str,
    config_type: str = "string",
    updated_by: str | None = None,
) -> None:
    """Upsert a config value."""
    await conn.execute(
        """
        INSERT INTO system_config (key, value, type, updated_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, type = EXCLUDED.type, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        """,
        key,
        value,
        config_type,
        updated_by,
    )


async def get_all_config(conn: asyncpg.Connection) -> dict[str, str]:
    """Fetch all config as a dict."""
    rows = await conn.fetch("SELECT key, value FROM system_config ORDER BY key")
    return {row["key"]: row["value"] for row in rows}
