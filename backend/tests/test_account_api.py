"""Account API (ADR-014 ticket #3a) end-to-end through the app, against a real
Postgres. `require_active_user` is overridden to inject a verified Principal (auth
itself is covered by test_auth_jwks); the DB and routing are exercised for real.
Skipped without DATABASE_URL."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")

TEST_SUB = "api-test-sub"
ACCOUNT = "/api/v1/account"


@pytest.fixture
def client():
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=TEST_SUB, email="t@example.com", issuer="https://test"
    )
    with TestClient(app) as c:
        try:
            yield c
        finally:
            c.delete(ACCOUNT)  # purge the test account (idempotent)
    app.dependency_overrides.clear()


def test_get_lazily_provisions_account(client):
    r = client.get(ACCOUNT)
    assert r.status_code == 200
    body = r.json()
    assert body["sub"] == TEST_SUB
    assert body["email"] == "t@example.com"
    assert body["credentials"] == []


def test_put_then_list_credential(client):
    r = client.put(
        f"{ACCOUNT}/credentials/anthropic", json={"source": "device_local", "status": "valid"}
    )
    assert r.status_code == 200
    assert r.json()["provider_id"] == "anthropic"

    body = client.get(ACCOUNT).json()
    assert [c["provider_id"] for c in body["credentials"]] == ["anthropic"]
    assert body["credentials"][0]["source"] == "device_local"
    assert body["credentials"][0]["status"] == "valid"


def test_put_credential_updates_in_place(client):
    client.put(f"{ACCOUNT}/credentials/anthropic", json={"source": "device_local"})
    client.put(
        f"{ACCOUNT}/credentials/anthropic", json={"source": "managed_vault", "status": "valid"}
    )
    creds = client.get(ACCOUNT).json()["credentials"]
    assert len(creds) == 1
    assert creds[0]["source"] == "managed_vault"


@pytest.mark.parametrize(
    "payload", [{"source": "bogus"}, {"source": "device_local", "status": "x"}]
)
def test_put_invalid_enum_422(client, payload):
    r = client.put(f"{ACCOUNT}/credentials/anthropic", json=payload)
    assert r.status_code == 422


def test_delete_credential(client):
    client.put(f"{ACCOUNT}/credentials/anthropic", json={"source": "device_local"})
    assert client.delete(f"{ACCOUNT}/credentials/anthropic").status_code == 204
    assert client.get(ACCOUNT).json()["credentials"] == []


def test_delete_account_purges(client):
    client.put(f"{ACCOUNT}/credentials/anthropic", json={"source": "device_local"})
    assert client.delete(ACCOUNT).status_code == 204
    # A later GET re-provisions a fresh, empty account.
    assert client.get(ACCOUNT).json()["credentials"] == []


def test_requires_auth_without_override():
    # No dependency override → real require_user; no token (and no OIDC configured) → 401.
    with TestClient(app) as c:
        assert c.get(ACCOUNT).status_code == 401
