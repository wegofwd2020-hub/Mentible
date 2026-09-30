"""Live intervention config manager — reads from DB with env var fallback."""

from __future__ import annotations

import os

import asyncpg
import structlog

from backend.config import settings
from backend.src.admin import config_repo

log = structlog.get_logger(__name__)

# Module-level cache of intervention config
_cache: dict[str, int] = {
    "intervention_retry_interval_days": settings.intervention_retry_interval_days,
    "max_intervention_attempts": settings.max_intervention_attempts,
}


async def load_intervention_config(conn: asyncpg.Connection) -> None:
    """Load intervention config from DB into cache. Env vars take precedence."""
    global _cache

    # Try to load from DB; fall back to env if table doesn't exist yet
    try:
        db_values = await config_repo.get_all_config(conn)

        # Only use DB values if env vars not explicitly set
        if "INTERVENTION_RETRY_INTERVAL_DAYS" not in os.environ:
            if "intervention_retry_interval_days" in db_values:
                _cache["intervention_retry_interval_days"] = int(db_values["intervention_retry_interval_days"])

        if "MAX_INTERVENTION_ATTEMPTS" not in os.environ:
            if "max_intervention_attempts" in db_values:
                _cache["max_intervention_attempts"] = int(db_values["max_intervention_attempts"])
    except Exception as e:
        log.warning("failed to load intervention config from DB", error=str(e))


def get_intervention_retry_interval_days() -> int:
    """Get current retry interval (cached value)."""
    return _cache.get("intervention_retry_interval_days", settings.intervention_retry_interval_days)


def get_max_intervention_attempts() -> int:
    """Get current max attempts (cached value)."""
    return _cache.get("max_intervention_attempts", settings.max_intervention_attempts)


async def update_intervention_config(
    conn: asyncpg.Connection,
    retry_interval_days: int | None = None,
    max_attempts: int | None = None,
    updated_by: str | None = None,
) -> dict[str, int]:
    """Update intervention config in DB and refresh cache."""
    global _cache

    # Validate
    if retry_interval_days is not None and retry_interval_days < 1:
        raise ValueError("retry_interval_days must be >= 1")
    if max_attempts is not None and max_attempts < 1:
        raise ValueError("max_attempts must be >= 1")

    # Write to DB
    if retry_interval_days is not None:
        await config_repo.set_config(
            conn,
            "intervention_retry_interval_days",
            str(retry_interval_days),
            config_type="int",
            updated_by=updated_by,
        )
        _cache["intervention_retry_interval_days"] = retry_interval_days

    if max_attempts is not None:
        await config_repo.set_config(
            conn,
            "max_intervention_attempts",
            str(max_attempts),
            config_type="int",
            updated_by=updated_by,
        )
        _cache["max_intervention_attempts"] = max_attempts

    return _cache.copy()
