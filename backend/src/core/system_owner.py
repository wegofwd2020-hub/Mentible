"""The system-owner (super-admin) principal — ADR-018.

A single privileged principal that owns the default application + library
(ADR-017) and may publish/curate it. This module is the one place that knows how
to *identify* the owner and *verify* an owner credential; the publish gate (D2),
vault custody (D4), and any owner-only surface (D5) authenticate through here.

Deliberately narrow (ADR-018 D3): this is NOT an RBAC system and NOT a user
account. There is exactly one owner, defined by config (ADR-018 D1) — never a
role claim on the user IdP. It grants authority over *default / shipped* assets
and ops only; it confers no access to user-owned libraries or content.

Secret discipline (ADR-018 D6 / ADR-001): the owner secret is compared in
constant time and never logged. `owner_identity()` returns only the non-secret
id, safe to put in audit log lines.
"""

from __future__ import annotations

import hmac

from backend.config import settings


def owner_id() -> str:
    """The system-owner's stable, non-secret identifier.

    Use as the default library's publisher/owner of record and as the `actor`
    field in owner-action audit logs (ADR-018 D2/D6). Safe to log.
    """
    return settings.system_owner_id


def verify_owner_secret(provided: str | None) -> bool:
    """True iff `provided` matches the configured owner secret.

    Constant-time comparison (`hmac.compare_digest`) so a caller can't time the
    check to recover the secret. A missing/empty/non-str credential is rejected
    without comparing, and the secret is never echoed or logged here.

    This is the single authentication primitive for owner-only actions
    (publishing into the default set, vault ops). Callers should fail closed:
    treat a False result as "not the owner" and refuse the privileged action.
    """
    if not provided or not isinstance(provided, str):
        return False
    return hmac.compare_digest(provided, settings.system_owner_secret)
