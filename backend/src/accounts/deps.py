"""Account-aware auth dependency — `require_active_user` (ADR-020 D3.1 / O6).

The FastAPI-canonical split: `require_user` (in `auth/deps.py`) is the pure,
DB-free verify primitive — the portable seam that maps to the future
`wegofwd-identity` (ADR-020 D8). Suspension is *app state* (a DB flag), so the
check that rejects a suspended caller lives here, in the accounts layer, not in
the verify path.

`require_active_user` is the standard dependency for authenticated routes: it
verifies the token (via `require_user`) and then 403s if that account is
suspended. With no account store configured (anonymous demo), there is no
suspension state, so it is a pass-through.

O6 caveat: this blocks our authenticated routes only. Public BYOK generation
(`/generate`, key in the request body) is not gated by auth and is therefore not
stopped by a suspend; gating generation is a separate, still-open decision.
"""

from __future__ import annotations

import asyncpg
from fastapi import Depends, HTTPException, Request, status

from backend.src.accounts import repo
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


async def require_active_user(
    request: Request, principal: Principal = Depends(require_user)
) -> Principal:
    """Verified caller who is not suspended; else 403. Pass-through when no DB."""
    pool: asyncpg.Pool | None = getattr(request.app.state, "db", None)
    if pool is None:
        return principal  # no account store → no suspension state
    async with pool.acquire() as conn:
        account = await repo.get_account(conn, idp_sub=principal.sub)
    if account is not None and account.suspended:
        # Body names no identity (key/identity discipline).
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account suspended")
    return principal
