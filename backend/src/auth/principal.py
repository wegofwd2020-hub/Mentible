"""The authenticated end-user principal — ADR-014 D1.

A `Principal` is derived from a *verified* IdP JWT. It carries only the identity
reference (the IdP `sub`, the account key per ADR-014 D8) and a couple of
non-sensitive claims — **never** a credential, an LLM key, or the raw token. The
session JWT is OUR token, never the user's LLM key (CLAUDE.md).

Distinct from the ADR-018 system-owner, which is a config-bootstrapped
super-admin principal, not an IdP account.
"""

from __future__ import annotations

from dataclasses import dataclass


class AuthError(Exception):
    """The caller's identity token is missing, malformed, or fails verification.

    Carries a KEY-FREE, token-FREE message (type/reason only) — the token and its
    claims must never reach a log line or an exception string. Mapped to HTTP 401
    at the dependency boundary (see `deps.py`).
    """


@dataclass(frozen=True)
class Principal:
    """An authenticated user. Immutable; safe to stash on the request."""

    # The IdP subject — the stable, opaque user id. This is the key the account
    # row and the synced library hang off (ADR-014 D8); it is NOT an email.
    sub: str
    # Convenience claims, when the IdP includes them. Never required for identity.
    email: str | None
    # The token issuer that was verified (the configured OIDC issuer).
    issuer: str
