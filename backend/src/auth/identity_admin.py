"""Supabase Auth Admin — hard-delete an auth identity (amends ADR-014; see ADR-022).

The account/admin delete endpoints purge the app DB `account` row; on their own
that leaves the Supabase auth user intact, so the same Google/email signs back in
as a *returning* identity rather than a fresh registration. This module adds the
missing half: deleting the Supabase auth user via the Auth Admin API so a deleted
email can re-register as a brand-new user.

It requires the high-privilege service-role key (`settings.supabase_service_role_key`).
When that key is unset, `delete_identity` is a no-op and the endpoints keep their
pre-existing app-row-only behavior (graceful degradation — never a startup or
request failure). This deliberately reverses ADR-014's "no service-role secret in
the app runtime" stance for the deletion path only — see ADR-022.

Security: the service-role key is NEVER logged (ADR-001 discipline) — it travels
only in the request headers here and is not passed to any log call.
"""

from __future__ import annotations

import httpx

from backend.config import settings
from backend.src.core.log_redaction import get_logger

log = get_logger()

# Auth Admin deletes are a single small call; keep the timeout tight so a delete
# request never hangs on a Supabase hiccup.
_TIMEOUT = httpx.Timeout(10.0)


def identity_deletion_enabled() -> bool:
    """True iff both the service-role key and a resolvable Supabase URL are set."""
    return bool(settings.supabase_service_role_key and settings.resolved_supabase_url)


async def delete_identity(sub: str) -> bool:
    """Hard-delete the Supabase auth user `sub` (the JWT subject == Supabase user id).

    Returns True if the identity was deleted (or was already absent — 404), and
    False if identity deletion is disabled (no service-role key configured), in
    which case the caller falls back to the app-row-only purge. Raises
    httpx.HTTPStatusError if deletion is enabled but the Auth Admin call fails, so
    the caller can surface it rather than silently leaving the identity behind.
    """
    if not identity_deletion_enabled():
        log.info("identity_delete_skipped", reason="no_service_role_key")
        return False

    base = settings.resolved_supabase_url
    key = settings.supabase_service_role_key
    # NB: `key` goes only into these headers — never into a log line.
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.delete(f"{base}/auth/v1/admin/users/{sub}", headers=headers)

    # 200/204 = deleted; 404 = already gone (idempotent — treat as success).
    if resp.status_code in (200, 204, 404):
        log.info("identity_deleted", status=resp.status_code)
        return True

    log.error("identity_delete_failed", status=resp.status_code)
    raise httpx.HTTPStatusError(
        f"Supabase auth-user delete failed: HTTP {resp.status_code}",
        request=resp.request,
        response=resp,
    )
