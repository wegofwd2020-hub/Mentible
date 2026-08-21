"""HTTP-level tests for `synced_shelves` (ADR-014 increment 2) — mirrors
`test_sync_router.py`'s TestClient + `require_active_user` override + DSN-skip
pattern. Shelves is a single JSON+base64 blob per account (like the keyset),
not framed octet-stream (unlike the epub routes).

Skipped without DATABASE_URL, like every other DB-backed test module here.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import uuid

import asyncpg
import pytest
import structlog
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.log_redaction import redact_keys

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")

SYNC = "/api/v1/sync"


def _as(sub: str, email: str | None = None) -> None:
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


async def _make_account(sub: str, email: str | None = None) -> None:
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute(
            "INSERT INTO account (idp_sub, email) VALUES ($1, $2) ON CONFLICT (idp_sub) DO NOTHING",
            sub,
            email,
        )
    finally:
        await conn.close()


def _account(sub: str, email: str | None = None) -> None:
    asyncio.run(_make_account(sub, email))


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _shelves_body(seed: bytes = b"x") -> dict:
    return {
        "ciphertext": _b64(seed + b"-shelves-ciphertext" * 4),
        "nonce": _b64(seed + b"-nonce"),
        "wrapped_dk": _b64(seed + b"-wrapped-dk"),
        "dk_nonce": _b64(seed + b"-dk-nonce"),
        "client_version": "v1",
    }


# ── (a) round-trip ───────────────────────────────────────────────────────────


def test_put_then_get_shelves_roundtrips():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    body = _shelves_body(b"rt")
    with TestClient(app) as c:
        _as(sub)
        put = c.put(f"{SYNC}/shelves", json=body)
        assert put.status_code == 200
        assert put.json()["ciphertext"] == body["ciphertext"]

        got = c.get(f"{SYNC}/shelves")
        assert got.status_code == 200
        got_json = got.json()
        assert got_json["ciphertext"] == body["ciphertext"]
        assert got_json["nonce"] == body["nonce"]
        assert got_json["wrapped_dk"] == body["wrapped_dk"]
        assert got_json["dk_nonce"] == body["dk_nonce"]
        assert got_json["client_version"] == "v1"


def test_put_shelves_overwrites_on_second_put():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        assert c.put(f"{SYNC}/shelves", json=_shelves_body(b"first")).status_code == 200
        second = _shelves_body(b"second")
        assert c.put(f"{SYNC}/shelves", json=second).status_code == 200

        got = c.get(f"{SYNC}/shelves").json()
        assert got["ciphertext"] == second["ciphertext"]


def test_get_shelves_404_when_absent():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        assert c.get(f"{SYNC}/shelves").status_code == 404


def test_put_shelves_bad_base64_400():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        body = _shelves_body()
        body["ciphertext"] = "not-valid-base64!!!"
        r = c.put(f"{SYNC}/shelves", json=body)
        assert r.status_code == 400


# ── (b) isolation ────────────────────────────────────────────────────────────


def test_shelves_isolation_invisible_to_other_account():
    sub_a = f"sk-a-{uuid.uuid4()}"
    sub_b = f"sk-b-{uuid.uuid4()}"
    _account(sub_a)
    _account(sub_b)
    with TestClient(app) as c:
        _as(sub_a)
        assert c.put(f"{SYNC}/shelves", json=_shelves_body(b"a-secret")).status_code == 200

        _as(sub_b)
        assert c.get(f"{SYNC}/shelves").status_code == 404
        # B can still create its own — proves the 404 above wasn't a routing
        # fluke and B's write path is independent of A's row.
        assert c.put(f"{SYNC}/shelves", json=_shelves_body(b"b-secret")).status_code == 200

        _as(sub_a)
        got_a = c.get(f"{SYNC}/shelves").json()
        assert got_a["ciphertext"] == _shelves_body(b"a-secret")["ciphertext"]


# ── (c) log cleanliness (ADR-001) ───────────────────────────────────────────


def _capture_log_output() -> io.StringIO:
    buffer = io.StringIO()

    def _writer(_logger, _method, event_dict):
        buffer.write(json.dumps(event_dict) + "\n")
        return event_dict

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            redact_keys,
            _writer,
            structlog.processors.JSONRenderer(),
        ],
        cache_logger_on_first_use=False,
    )
    return buffer


def test_no_ciphertext_or_key_bytes_in_logs(capsys):
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    body = _shelves_body(b"log-probe-shelves")

    buffer = _capture_log_output()
    with TestClient(app) as c:
        _as(sub)
        assert c.put(f"{SYNC}/shelves", json=body).status_code == 200

    log_text = buffer.getvalue()
    captured = capsys.readouterr()
    combined = log_text + captured.out + captured.err

    for secret_field in (
        body["ciphertext"],
        body["nonce"],
        body["wrapped_dk"],
        body["dk_nonce"],
    ):
        assert secret_field not in combined, f"secret leaked into logs: {secret_field[:20]}..."
