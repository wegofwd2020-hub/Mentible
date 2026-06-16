"""Stateless JWKS verification of an IdP access token — ADR-014 D1.

We build no authentication. Login is the IdP's job; here we only *verify* a JWT:
check its signature against the IdP's published JWKS, then the issuer, audience,
and expiry. No DB, no session store, no refresh handling. On success we return a
`Principal`; on any failure, an `AuthError` whose message names only the failure
*type* — never the token or its claims (key-discipline, ADR-001/D8).

Vendor-agnostic by construction: the verifier takes an issuer, an audience, and a
`key_resolver` that maps a token to its signing key. Production wires the resolver
to a cached `PyJWKClient` (Supabase JWKS, O1); tests inject a local public key, so
no network is touched in CI.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import jwt

from backend.src.auth.principal import AuthError, Principal

# Supabase signs access tokens with asymmetric keys (RS256/ES256). HS256 (the
# legacy shared-secret mode) is deliberately excluded: a JWKS verifier must never
# accept a symmetric algorithm, or a leaked public key becomes a signing key.
_ALGORITHMS = ["RS256", "ES256"]

# token -> the public key to verify it with (a cryptography key or PyJWK.key).
KeyResolver = Callable[[str], Any]


class JwtVerifier:
    """Verifies IdP JWTs against a JWKS and returns a `Principal`."""

    def __init__(self, *, issuer: str, audience: str, key_resolver: KeyResolver) -> None:
        self._issuer = issuer
        self._audience = audience
        self._resolve = key_resolver

    def verify(self, token: str) -> Principal:
        try:
            key = self._resolve(token)
            claims: dict[str, Any] = jwt.decode(
                token,
                key,
                algorithms=_ALGORITHMS,
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "iss", "sub"]},
            )
        except jwt.PyJWTError as exc:
            # Type only — never the token or claims (they may carry sensitive data).
            raise AuthError(f"token rejected: {type(exc).__name__}") from None

        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise AuthError("token missing a usable sub claim")
        email = claims.get("email")
        return Principal(
            sub=sub,
            email=email if isinstance(email, str) and email else None,
            issuer=str(claims["iss"]),
        )


def _jwks_url(issuer: str, override: str) -> str:
    if override:
        return override
    return issuer.rstrip("/") + "/.well-known/jwks.json"


def build_verifier(*, issuer: str, audience: str, jwks_url: str = "") -> JwtVerifier | None:
    """Construct a verifier from config, or None when identity is disabled.

    Returns None if `issuer` is empty — the anonymous-demo path (ADR-014: MVP is
    identity-optional). The `PyJWKClient` fetches and caches keys lazily on first
    use, so building one here touches no network.
    """
    if not issuer:
        return None
    client = jwt.PyJWKClient(_jwks_url(issuer, jwks_url))
    return JwtVerifier(
        issuer=issuer,
        audience=audience,
        key_resolver=lambda token: client.get_signing_key_from_jwt(token).key,
    )
