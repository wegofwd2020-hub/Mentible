"""asyncpg connection pool — the account store's runtime driver (CLAUDE.md rule 6).

Optional, like identity: when DATABASE_URL is empty the pool is None (anonymous
demo; account routes are simply unavailable). The pool is created in the app
lifespan and acquired per request; this module only constructs it.
"""

from __future__ import annotations

import asyncpg


async def create_pool(dsn: str) -> asyncpg.Pool | None:
    """Create the account-store pool, or None when no DSN is configured."""
    if not dsn:
        return None
    return await asyncpg.create_pool(dsn, min_size=1, max_size=10)
