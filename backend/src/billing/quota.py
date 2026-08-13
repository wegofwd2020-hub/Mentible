"""Free/Pro usage counts + plan status (T1 foundation, ADR-005/037).

Computes — never enforces (that's T2) — where an account stands against the Free
caps: how many `project` rows it owns, and how many generations (`topic_version` +
`artifact_version` rows it authored) it's produced in the rolling Free window. Pro
accounts (`access.is_pro`) are never at a cap; the caps exist only to describe the
Free tier.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import asyncpg

from backend.config import settings
from backend.src.billing.access import is_pro


@dataclass(frozen=True)
class PlanStatus:
    is_pro: bool
    max_projects: int
    max_generations: int
    gen_window_days: int
    projects: int
    generations: int
    at_project_cap: bool
    at_generation_cap: bool


async def count_projects(conn: asyncpg.Connection, account_id: UUID) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM project WHERE owner_account_id = $1", account_id
    )


async def count_generations(conn: asyncpg.Connection, sub: str, since: datetime) -> int:
    """Generations = per-topic drafts (`topic_version`) + artifact versions
    (`artifact_version`) the account authored, since `since`. A single query so the
    two counts are consistent as of one read."""
    return await conn.fetchval(
        "SELECT (SELECT count(*) FROM topic_version WHERE created_by_sub = $1 AND created_at >= $2)"
        "     + (SELECT count(*) FROM artifact_version WHERE created_by_sub = $1 AND created_at >= $2)",
        sub,
        since,
    )


async def plan_status(conn: asyncpg.Connection, *, account_id: UUID, sub: str) -> PlanStatus:
    """The account's Free/Pro status: caps, current usage, and whether it's at
    either cap. Pro accounts are never at a cap regardless of usage."""
    pro = await is_pro(conn, account_id=account_id)
    since = datetime.now(UTC) - timedelta(days=settings.free_gen_window_days)
    projects = await count_projects(conn, account_id)
    generations = await count_generations(conn, sub, since)
    return PlanStatus(
        is_pro=pro,
        max_projects=settings.free_max_projects,
        max_generations=settings.free_max_generations,
        gen_window_days=settings.free_gen_window_days,
        projects=projects,
        generations=generations,
        at_project_cap=(not pro) and projects >= settings.free_max_projects,
        at_generation_cap=(not pro) and generations >= settings.free_max_generations,
    )
