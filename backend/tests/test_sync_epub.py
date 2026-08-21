"""HTTP-level tests for `synced_epub` (ADR-014 increment 2) — mirrors
`test_sync_router.py`'s TestClient + `require_active_user` override + DSN-skip
pattern.

The epub payload is a FRAMED octet-stream body (4-byte big-endian meta_len +
meta_ciphertext + epub_ciphertext), never JSON — so these tests build/parse
the frame directly instead of using `TestClient(..., json=...)`.

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
from backend.src.sync import router as sync_router

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


def _frame(meta_ct: bytes, epub_ct: bytes) -> bytes:
    return len(meta_ct).to_bytes(4, "big") + meta_ct + epub_ct


def _epub_headers(seed: bytes = b"x", client_version: str = "v1") -> dict:
    return {
        "X-Nonce": _b64(seed + b"-nonce"),
        "X-Meta-Nonce": _b64(seed + b"-meta-nonce"),
        "X-Wrapped-Dk": _b64(seed + b"-wrapped-dk"),
        "X-Dk-Nonce": _b64(seed + b"-dk-nonce"),
        "X-Client-Version": client_version,
    }


def _put_epub(c: TestClient, epub_id: str, meta_ct: bytes, epub_ct: bytes, **hdr_kwargs):
    return c.put(
        f"{SYNC}/epubs/{epub_id}",
        content=_frame(meta_ct, epub_ct),
        headers={**_epub_headers(**hdr_kwargs), "Content-Type": "application/octet-stream"},
    )


# ── (a) round-trip: PUT (framed) → GET returns the framed body byte-for-byte ─


def test_put_then_get_epub_roundtrips_framed_body_byte_for_byte():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    meta_ct = b"cover-svg-and-title-ciphertext" * 5
    epub_ct = b"epub-bytes-ciphertext" * 100
    with TestClient(app) as c:
        _as(sub)
        put = _put_epub(c, "book-1", meta_ct, epub_ct, seed=b"rt")
        assert put.status_code == 200
        put_json = put.json()
        assert put_json["epub_id"] == "book-1"
        assert put_json["byte_size"] == len(epub_ct)
        assert put_json["deleted"] is False
        assert "ciphertext" not in put_json  # PUT response is metadata-only

        got = c.get(f"{SYNC}/epubs/book-1")
        assert got.status_code == 200
        assert got.content == _frame(meta_ct, epub_ct)
        assert got.headers["x-nonce"] == _b64(b"rt-nonce")
        assert got.headers["x-meta-nonce"] == _b64(b"rt-meta-nonce")
        assert got.headers["x-wrapped-dk"] == _b64(b"rt-wrapped-dk")
        assert got.headers["x-dk-nonce"] == _b64(b"rt-dk-nonce")
        assert got.headers["x-client-version"] == "v1"
        assert got.headers["content-type"] == "application/octet-stream"


def test_get_epub_404_when_absent():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        assert c.get(f"{SYNC}/epubs/does-not-exist").status_code == 404


# ── (b) manifest is metadata-only ───────────────────────────────────────────


def test_list_epubs_is_metadata_only():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    epub_ct = b"epub-bytes" * 10
    with TestClient(app) as c:
        _as(sub)
        assert _put_epub(c, "m1", b"meta", epub_ct).status_code == 200

        listing = c.get(f"{SYNC}/epubs")
        assert listing.status_code == 200
        rows = listing.json()
        assert len(rows) == 1
        row = rows[0]
        assert row["epub_id"] == "m1"
        assert row["byte_size"] == len(epub_ct)
        assert row["deleted"] is False
        assert set(row.keys()) == {"epub_id", "client_version", "deleted", "updated_at", "byte_size"}


# ── (c) DELETE tombstones: deleted=true, byte_size=0 ────────────────────────


def test_delete_epub_tombstones_and_zeroes_byte_size():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        assert _put_epub(c, "d1", b"meta", b"epub-bytes" * 5).status_code == 200

        assert c.delete(f"{SYNC}/epubs/d1").status_code == 204

        rows = c.get(f"{SYNC}/epubs").json()
        assert len(rows) == 1
        assert rows[0]["deleted"] is True
        assert rows[0]["byte_size"] == 0


def test_delete_epub_404_when_absent():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        assert c.delete(f"{SYNC}/epubs/nope").status_code == 404


# ── (d) caps ─────────────────────────────────────────────────────────────────


def test_put_epub_over_per_file_cap_413():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    oversize = b"x" * (sync_router._MAX_EPUB_BYTES + 1)
    with TestClient(app) as c:
        _as(sub)
        r = _put_epub(c, "too-big", b"meta", oversize)
        assert r.status_code == 413
        assert r.json()["detail"] == "epub too large"


def test_put_epub_over_soft_total_cap_413_with_distinct_detail(monkeypatch):
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    # Lower the soft cap for this test so we don't need to push 500MB over
    # the wire — the per-file cap is checked first and independently.
    monkeypatch.setattr(sync_router, "_SOFT_CAP_BYTES", 1000)
    with TestClient(app) as c:
        _as(sub)
        first = _put_epub(c, "s1", b"m", b"a" * 600, seed=b"s1")
        assert first.status_code == 200

        second = _put_epub(c, "s2", b"m", b"b" * 600, seed=b"s2")
        assert second.status_code == 413
        assert second.json()["detail"] == "sync storage full"
        # Distinct from the per-file cap's detail string.
        assert second.json()["detail"] != "epub too large"


def test_put_epub_re_put_excludes_its_own_prior_size_from_the_cap(monkeypatch):
    """Regression guard: overwriting an existing epub must not double-count
    its own previous byte_size against the soft cap."""
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    monkeypatch.setattr(sync_router, "_SOFT_CAP_BYTES", 1000)
    with TestClient(app) as c:
        _as(sub)
        assert _put_epub(c, "r1", b"m", b"a" * 900, seed=b"r1").status_code == 200
        # Re-putting the SAME epub_id with a similar size must succeed —
        # naive total+new (without subtracting existing) would 413 here.
        r2 = _put_epub(c, "r1", b"m", b"b" * 900, seed=b"r1")
        assert r2.status_code == 200


# ── (e) isolation ────────────────────────────────────────────────────────────


def test_epub_isolation_invisible_to_other_account():
    sub_a = f"sk-a-{uuid.uuid4()}"
    sub_b = f"sk-b-{uuid.uuid4()}"
    _account(sub_a)
    _account(sub_b)
    with TestClient(app) as c:
        _as(sub_a)
        assert _put_epub(c, "shared-id", b"meta", b"a-secret" * 10).status_code == 200

        _as(sub_b)
        assert c.get(f"{SYNC}/epubs/shared-id").status_code == 404
        assert c.get(f"{SYNC}/epubs").json() == []
        assert c.delete(f"{SYNC}/epubs/shared-id").status_code == 404

        _as(sub_a)
        listing = c.get(f"{SYNC}/epubs").json()
        assert [m["epub_id"] for m in listing] == ["shared-id"]


# ── (f) log cleanliness (ADR-001) ───────────────────────────────────────────


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


def test_no_epub_bytes_or_key_material_in_logs(capsys):
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    meta_ct = b"LOG-PROBE-META-CIPHERTEXT" * 3
    epub_ct = b"LOG-PROBE-EPUB-CIPHERTEXT" * 20
    headers = _epub_headers(seed=b"log-probe-secret")

    buffer = _capture_log_output()
    with TestClient(app) as c:
        _as(sub)
        r = c.put(
            f"{SYNC}/epubs/log-probe",
            content=_frame(meta_ct, epub_ct),
            headers={**headers, "Content-Type": "application/octet-stream"},
        )
        assert r.status_code == 200
        assert c.get(f"{SYNC}/epubs/log-probe").status_code == 200

    log_text = buffer.getvalue()
    captured = capsys.readouterr()
    combined = log_text + captured.out + captured.err

    for secret in (
        meta_ct.decode("latin-1"),
        epub_ct.decode("latin-1"),
        headers["X-Nonce"],
        headers["X-Meta-Nonce"],
        headers["X-Wrapped-Dk"],
        headers["X-Dk-Nonce"],
    ):
        assert secret not in combined, f"secret leaked into logs: {secret[:20]}..."

    assert "log-probe" in combined
