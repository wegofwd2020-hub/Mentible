"""Free/Pro usage counts, plan status, and the shared Free generations counter.

Caps: 2 projects owned, and 20 generations per rolling 30 days (ADR-037 D3 / ADR-043).
`charge_generation` enforces the generation cap (402) and records each generation in
`generation_event` in one atomic step; every generation route calls it. Pro accounts
(`access.is_pro`) are never refused. Project caps are enforced in the trust router.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import asyncpg
from fastapi import HTTPException

from backend.config import settings
from backend.src.billing.access import account_features, is_pro


def pro_required(detail: str) -> HTTPException:
    """A consistent 402 (Payment Required) for a Free-plan-over-cap gate — the
    server-side enforcement (T2). The client keys UI off this status + the
    `detail` string; keep the message actionable ("… upgrade to Pro.")."""
    return HTTPException(status_code=402, detail=detail)


def feature_required(feature: str) -> HTTPException:
    """A 402 for a capability the caller's plan does not grant (T-P0-3). Names the
    missing feature so the client can show the right upsell."""
    return HTTPException(
        status_code=402,
        detail=f"This export format needs Pro ({feature}). Upgrade to Pro to download.",
    )


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
    features: tuple[str, ...]


async def count_projects(conn: asyncpg.Connection, account_id: UUID) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM project WHERE owner_account_id = $1", account_id
    )


async def count_generations(conn: asyncpg.Connection, account_id: UUID, since: datetime) -> int:
    """Generations the account started since `since`, from the shared `generation_event`
    counter (written by every generation route — see `charge_generation`)."""
    return await conn.fetchval(
        "SELECT count(*) FROM generation_event WHERE account_id = $1 AND created_at >= $2",
        account_id,
        since,
    )


async def charge_generation(
    conn: asyncpg.Connection, *, account_id: UUID, route: str, count: int = 1
) -> None:
    """Enforce the Free generations cap and record `count` generations, atomically.

    `count` > 1 is for fan-out jobs (a whole book = one generation per missing topic). The
    charge is all-or-nothing: if `used + count` would exceed the cap, nothing is recorded
    and the request is refused with 402.

    Called by every generation entry point, after its idempotency check and before any job
    or envelope is created. Pro accounts are never refused, but their generations are still
    recorded so the counter stays truthful.

    A per-account transaction advisory lock serialises concurrent submits, so two requests
    racing at 19 cannot both pass the check.
    """
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", str(account_id))
        if not await is_pro(conn, account_id=account_id):
            since = datetime.now(UTC) - timedelta(days=settings.free_gen_window_days)
            used = await count_generations(conn, account_id, since)
            if used + count > settings.free_max_generations:
                raise pro_required(
                    f"Free plan is limited to {settings.free_max_generations} generations "
                    f"per {settings.free_gen_window_days} days — upgrade to Pro."
                )
        await conn.execute(
            "INSERT INTO generation_event (account_id, route) "
            "SELECT $1, $2 FROM generate_series(1, $3)",
            account_id,
            route,
            count,
        )


async def plan_status(conn: asyncpg.Connection, *, account_id: UUID) -> PlanStatus:
    """The account's Free/Pro status: caps, current usage, and whether it's at
    either cap. Pro accounts are never at a cap regardless of usage."""
    pro = await is_pro(conn, account_id=account_id)
    since = datetime.now(UTC) - timedelta(days=settings.free_gen_window_days)
    projects = await count_projects(conn, account_id)
    generations = await count_generations(conn, account_id, since)
    feats = await account_features(conn, account_id=account_id)
    return PlanStatus(
        is_pro=pro,
        max_projects=settings.free_max_projects,
        max_generations=settings.free_max_generations,
        gen_window_days=settings.free_gen_window_days,
        projects=projects,
        generations=generations,
        at_project_cap=(not pro) and projects >= settings.free_max_projects,
        at_generation_cap=(not pro) and generations >= settings.free_max_generations,
        features=tuple(sorted(feats)),
    )
