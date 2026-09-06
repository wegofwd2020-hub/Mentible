"""FastAPI dependencies that turn a verified IdP JWT into a `Principal` — ADR-014 D1.

Dependencies:
- `require_user` — 401 unless a valid bearer token is present. For routes that
  need an account (sync, usage; arriving later).
- `optional_user` — `Principal | None`; `None` when no token is sent (the
  anonymous demo), but still 401 on a present-but-*invalid* token (a broken token
  is a client bug, not anonymity).
- `require_super_admin` — builds on `require_user`; 403 unless the verified
  identity is in the operator allowlist (ADR-020 D2). Gates `/api/v1/admin/*`.

The verifier is built once at import from settings; a cached `PyJWKClient` lives
inside it. When identity is not configured (`OIDC_ISSUER` unset), the verifier is
None: `optional_user` yields anonymous and `require_user` returns 503 (the route
asked for auth the deployment hasn't enabled).

The verifier returns a `VerifiedToken` (the portable verify→claims seam, ADR-020
D8); `_to_principal` maps it to this app's `Principal` and derives `is_super_admin`
from the config allowlist — the per-app authorization that does NOT move into the
shared `wegofwd-identity` package.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from backend.config import settings
from backend.src.auth.admin import is_super_admin
from backend.src.auth.principal import AuthError, Principal, VerifiedToken
from backend.src.auth.verifier import build_verifier

# Built once. None when OIDC_ISSUER is unset (anonymous-demo deployments).
_verifier = build_verifier(
    issuer=settings.oidc_issuer,
    audience=settings.oidc_audience,
    jwks_url=settings.oidc_jwks_url,
)


def _to_principal(vt: VerifiedToken) -> Principal:
    """Map the portable verified-claims result to this app's authenticated user.

    The per-app half of ADR-020 D8: derive `is_super_admin` from the config
    allowlist here (never from a token claim, D2). Pramana maps the same seam to a
    different `Principal` with its own role model.
    """
    return Principal(
        sub=vt.sub,
        email=vt.email,
        issuer=vt.issuer,
        is_super_admin=is_super_admin(sub=vt.sub, email=vt.email),
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
        return _to_principal(_verifier.verify(token))
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
        return _to_principal(_verifier.verify(token))
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token"
        ) from None


def require_super_admin(principal: Principal = Depends(require_user)) -> Principal:
    """Resolve the caller and require the operator role — ADR-020 D2/D3.

    Builds on `require_user` (so its 401/503 mapping applies first), then 403s
    unless the verified identity is in the config allowlist. Gate for the
    `/api/v1/admin/*` surface. The 403 body names no identity.
    """
    if not principal.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="super-admin required")
    return principal


def require_feedback_viewer(principal: Principal = Depends(require_super_admin)) -> Principal:
    """Resolve the caller and require feedback-viewer permissions.

    The seam for feedback-viewer authz. Currently requires super-admin; may be
    extended to allow scoped feedback reviewer roles.
    """
    return principal
