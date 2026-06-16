"""User identity for Mentible — ADR-014 D1.

Stateless verification of an external IdP's JWT via JWKS. No authentication is
built here (no passwords, no auth DB, no refresh) — login belongs to the IdP
(Supabase, O1); we only verify and derive a `Principal`.
"""

from backend.src.auth.deps import optional_user, require_user
from backend.src.auth.principal import AuthError, Principal
from backend.src.auth.verifier import JwtVerifier, build_verifier

__all__ = [
    "AuthError",
    "JwtVerifier",
    "Principal",
    "build_verifier",
    "optional_user",
    "require_user",
]
