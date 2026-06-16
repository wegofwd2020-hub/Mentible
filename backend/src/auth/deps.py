"""FastAPI dependencies that turn a verified IdP JWT into a `Principal` — ADR-014 D1.

Two dependencies:
- `require_user` — 401 unless a valid bearer token is present. For routes that
  need an account (sync, usage; arriving later).
- `optional_user` — `Principal | None`; `None` when no token is sent (the
  anonymous demo), but still 401 on a present-but-*invalid* token (a broken token
  is a client bug, not anonymity).

The verifier is built once at import from settings; a cached `PyJWKClient` lives
inside it. When identity is not configured (`OIDC_ISSUER` unset), the verifier is
None: `optional_user` yields anonymous and `require_user` returns 503 (the route
asked for auth the deployment hasn't enabled).
"""

from __future__ import annotations

from fastapi import HTTPException, Request, status

from backend.config import settings
from backend.src.auth.principal import AuthError, Principal
from backend.src.auth.verifier import build_verifier

# Built once. None when OIDC_ISSUER is unset (anonymous-demo deployments).
_verifier = build_verifier(
    issuer=settings.oidc_issuer,
    audience=settings.oidc_audience,
    jwks_url=settings.oidc_jwks_url,
)


def _bearer_token(request: Request) -> str | None:
    """Extract a non-empty bearer token, or None. Case-insensitive scheme."""
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def optional_user(request: Request) -> Principal | None:
    """Resolve the caller, or None when no token is sent. 401 on an invalid token."""
    token = _bearer_token(request)
    if token is None or _verifier is None:
        return None
    try:
        return _verifier.verify(token)
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token"
        ) from None


def require_user(request: Request) -> Principal:
    """Resolve the caller; 401 if absent/invalid, 503 if identity isn't configured."""
    token = _bearer_token(request)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required"
        ) from None
    if _verifier is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="authentication not configured",
        ) from None
    try:
        return _verifier.verify(token)
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token"
        ) from None
