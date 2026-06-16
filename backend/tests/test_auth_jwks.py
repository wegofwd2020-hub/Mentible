"""JWKS verification (ADR-014 D1): a locally-signed RSA JWT stands in for the IdP,
so no network is touched. Covers the verifier's accept/reject rules and the
FastAPI dependencies' status mapping."""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from backend.src.auth import deps
from backend.src.auth.principal import AuthError, Principal
from backend.src.auth.verifier import JwtVerifier

ISSUER = "https://proj.supabase.co/auth/v1"
AUDIENCE = "authenticated"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _mint(*, key=_KEY, alg="RS256", **overrides) -> str:
    now = _now()
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "user-uuid-123",
        "email": "learner@example.com",
        "iat": now,
        "exp": now + dt.timedelta(hours=1),
    }
    payload.update(overrides)
    return jwt.encode(payload, key, algorithm=alg)


def _verifier(key=_KEY) -> JwtVerifier:
    return JwtVerifier(issuer=ISSUER, audience=AUDIENCE, key_resolver=lambda _t: key.public_key())


def test_valid_token_yields_principal():
    p = _verifier().verify(_mint())
    assert isinstance(p, Principal)
    assert p.sub == "user-uuid-123"
    assert p.email == "learner@example.com"
    assert p.issuer == ISSUER


def test_missing_email_is_none():
    assert _verifier().verify(_mint(email=None)).email is None


def test_wrong_audience_rejected():
    with pytest.raises(AuthError):
        _verifier().verify(_mint(aud="anon"))


def test_wrong_issuer_rejected():
    with pytest.raises(AuthError):
        _verifier().verify(_mint(iss="https://evil.example/auth"))


def test_bad_signature_rejected():
    # Signed with a key the resolver doesn't return.
    with pytest.raises(AuthError):
        _verifier().verify(_mint(key=_OTHER_KEY))


def test_expired_token_rejected():
    now = _now()
    expired = _mint(iat=now - dt.timedelta(hours=2), exp=now - dt.timedelta(hours=1))
    with pytest.raises(AuthError):
        _verifier().verify(expired)


def test_missing_sub_rejected():
    with pytest.raises(AuthError):
        _verifier().verify(_mint(sub=None))


def test_symmetric_algorithm_rejected():
    # An HS256 token must never verify against a JWKS verifier (alg-confusion guard).
    token = jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": "x", "exp": _now() + dt.timedelta(hours=1)},
        "shared-secret-at-least-32-bytes-long!!",
        algorithm="HS256",
    )
    with pytest.raises(AuthError):
        _verifier().verify(token)


def test_auth_error_message_leaks_no_token_or_claims():
    try:
        _verifier().verify(_mint(aud="anon"))
    except AuthError as e:
        msg = str(e)
        assert "user-uuid-123" not in msg
        assert "learner@example.com" not in msg


# ── dependency status mapping ────────────────────────────────────────────────


def _req(authorization: str | None = None):
    headers = {"authorization": authorization} if authorization is not None else {}
    return SimpleNamespace(headers=headers)


def test_require_user_no_header_401():
    with pytest.raises(HTTPException) as ei:
        deps.require_user(_req())
    assert ei.value.status_code == 401


def test_require_user_valid(monkeypatch):
    monkeypatch.setattr(deps, "_verifier", _verifier())
    assert deps.require_user(_req(f"Bearer {_mint()}")).sub == "user-uuid-123"


def test_require_user_invalid_token_401(monkeypatch):
    monkeypatch.setattr(deps, "_verifier", _verifier())
    with pytest.raises(HTTPException) as ei:
        deps.require_user(_req(f"Bearer {_mint(key=_OTHER_KEY)}"))
    assert ei.value.status_code == 401


def test_require_user_not_configured_503(monkeypatch):
    monkeypatch.setattr(deps, "_verifier", None)
    with pytest.raises(HTTPException) as ei:
        deps.require_user(_req(f"Bearer {_mint()}"))
    assert ei.value.status_code == 503


def test_optional_user_no_header_is_none(monkeypatch):
    monkeypatch.setattr(deps, "_verifier", _verifier())
    assert deps.optional_user(_req()) is None


def test_optional_user_invalid_token_401(monkeypatch):
    monkeypatch.setattr(deps, "_verifier", _verifier())
    with pytest.raises(HTTPException) as ei:
        deps.optional_user(_req(f"Bearer {_mint(key=_OTHER_KEY)}"))
    assert ei.value.status_code == 401
