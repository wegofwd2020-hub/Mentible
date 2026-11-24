"""HTTP-level tests for the zero-knowledge sync API (ADR-014 increment 1),
through the real app + a real Postgres — mirrors `test_trust_router.py`'s
TestClient + `require_active_user` override pattern.

Unlike the trust router (`get_or_create_account`), the sync router resolves
the account with the STRICT `accounts_repo.get_account` (404 if absent) — so
every test here inserts an `account` row for the Principal's `sub` before
calling an endpoint, via a short-lived direct `asyncpg` connection (same
pattern `test_trust_router.py` uses for out-of-band DB setup mid-test).

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
from src.sync.router import _MAX_CIPHERTEXT_B64_CHARS, _MAX_SMALL_FIELD_B64_CHARS

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


def _keyset_body(seed: bytes = b"x") -> dict:
    return {
        "wrapped_lmk": _b64(seed + b"-wrapped-lmk"),
        "lmk_nonce": _b64(seed + b"-lmk-nonce"),
        "kek_salt": _b64(seed + b"-kek-salt"),
    }


def _book_body(seed: bytes = b"x") -> dict:
    return {
        "ciphertext": _b64(seed + b"-ciphertext" * 4),
        "nonce": _b64(seed + b"-nonce"),
        "wrapped_dk": _b64(seed + b"-wrapped-dk"),
        "dk_nonce": _b64(seed + b"-dk-nonce"),
        "client_version": "v1",
    }


# ── (a0) first-time user: no pre-existing account row → enable-sync provisions it ──


async def _account_exists(sub: str) -> bool:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow("SELECT 1 FROM account WHERE idp_sub = $1", sub)
        return row is not None
    finally:
        await conn.close()


def test_enable_sync_provisions_account_for_first_time_user():
    # Regression: a brand-new signed-in user has NO account row yet. enable-sync
    # (PUT /keyset) must get_or_create it, not 404 ("Couldn't enable sync — 404").
    sub = f"sk-{uuid.uuid4()}"
    assert asyncio.run(_account_exists(sub)) is False  # no row before
    with TestClient(app) as c:
        _as(sub, "callmds@example.com")
        r = c.put(f"{SYNC}/keyset", json=_keyset_body(b"firsttime"))
        assert r.status_code == 200
    assert asyncio.run(_account_exists(sub)) is True  # row now provisioned


# ── (a) keyset conflict / force ─────────────────────────────────────────────


def test_put_keyset_twice_without_force_409_then_force_overwrites():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        r1 = c.put(f"{SYNC}/keyset", json=_keyset_body(b"first"))
        assert r1.status_code == 200

        r2 = c.put(f"{SYNC}/keyset", json=_keyset_body(b"second"))
        assert r2.status_code == 409

        # unchanged
        got = c.get(f"{SYNC}/keyset").json()
        assert got["wrapped_lmk"] == _keyset_body(b"first")["wrapped_lmk"]

        body3 = _keyset_body(b"third")
        body3["force"] = True
        r3 = c.put(f"{SYNC}/keyset", json=body3)
        assert r3.status_code == 200

        got2 = c.get(f"{SYNC}/keyset").json()
        assert got2["wrapped_lmk"] == body3["wrapped_lmk"]


# ── (b) size guards ──────────────────────────────────────────────────────────


def test_put_book_oversize_ciphertext_413():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        body = _book_body()
        # Exactly at the base64-length limit for the 20MB decoded cap, plus
        # slack, so the guard trips on length before any decode is attempted.
        body["ciphertext"] = "A" * (_MAX_CIPHERTEXT_B64_CHARS + 4)
        r = c.put(f"{SYNC}/books/too-big", json=body)
        assert r.status_code == 413


def test_put_keyset_oversized_wrapped_lmk_413():
    """FIX 2 — the small bytea fields (wrapped_lmk/lmk_nonce/kek_salt) are
    capped too, not just the book ciphertext."""
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        body = _keyset_body()
        body["wrapped_lmk"] = "A" * (_MAX_SMALL_FIELD_B64_CHARS + 4)
        r = c.put(f"{SYNC}/keyset", json=body)
        assert r.status_code == 413


# ── (c) 404 when absent / 400 on bad base64 ─────────────────────────────────


def test_get_keyset_and_book_404_when_absent():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        assert c.get(f"{SYNC}/keyset").status_code == 404
        assert c.get(f"{SYNC}/books/does-not-exist").status_code == 404


def test_put_keyset_bad_base64_400():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        body = _keyset_body()
        body["wrapped_lmk"] = "not-valid-base64!!!"
        r = c.put(f"{SYNC}/keyset", json=body)
        assert r.status_code == 400


def test_put_book_bad_base64_400():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        body = _book_body()
        body["ciphertext"] = "not-valid-base64!!!"
        r = c.put(f"{SYNC}/books/b1", json=body)
        assert r.status_code == 400


# ── (d) token-based isolation — the real boundary the repo tests can't see ──


def test_token_isolation_book_invisible_to_other_account():
    sub_a = f"sk-a-{uuid.uuid4()}"
    sub_b = f"sk-b-{uuid.uuid4()}"
    _account(sub_a)
    _account(sub_b)
    with TestClient(app) as c:
        _as(sub_a)
        put = c.put(f"{SYNC}/books/shared-id", json=_book_body(b"a-secret"))
        assert put.status_code == 200

        # Switch the override to account B's own Principal/token.
        _as(sub_b)
        assert c.get(f"{SYNC}/books/shared-id").status_code == 404
        assert c.get(f"{SYNC}/books").json() == []

        # A still sees its own book.
        _as(sub_a)
        listing = c.get(f"{SYNC}/books").json()
        assert [m["book_id"] for m in listing] == ["shared-id"]


def test_token_isolation_keyset_invisible_to_other_account():
    sub_a = f"sk-a-{uuid.uuid4()}"
    sub_b = f"sk-b-{uuid.uuid4()}"
    _account(sub_a)
    _account(sub_b)
    with TestClient(app) as c:
        _as(sub_a)
        assert c.put(f"{SYNC}/keyset", json=_keyset_body(b"a-key")).status_code == 200

        _as(sub_b)
        assert c.get(f"{SYNC}/keyset").status_code == 404
        # B can still create its own — proves the 404 above wasn't a routing
        # fluke and B's write path is independent of A's row.
        assert c.put(f"{SYNC}/keyset", json=_keyset_body(b"b-key")).status_code == 200


# ── (e) log cleanliness (ADR-001) ───────────────────────────────────────────


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
    keyset_body = _keyset_body(b"log-probe-key")
    book_body = _book_body(b"log-probe-book")

    buffer = _capture_log_output()
    with TestClient(app) as c:
        _as(sub)
        assert c.put(f"{SYNC}/keyset", json=keyset_body).status_code == 200
        assert c.put(f"{SYNC}/books/log-probe", json=book_body).status_code == 200

    log_text = buffer.getvalue()
    captured = capsys.readouterr()
    combined = log_text + captured.out + captured.err

    for secret_field in (
        keyset_body["wrapped_lmk"],
        keyset_body["lmk_nonce"],
        keyset_body["kek_salt"],
        book_body["ciphertext"],
        book_body["nonce"],
        book_body["wrapped_dk"],
        book_body["dk_nonce"],
    ):
        assert secret_field not in combined, f"secret leaked into logs: {secret_field[:20]}..."

    # Sanity: logging did happen (metadata is fine/expected). The sync
    # logger's bound-logger proxy may already be first-use-cached against the
    # app's real stdout config from an earlier test in this module (structlog
    # `cache_logger_on_first_use` caches per proxy instance, not globally
    # resettable after the fact) — so the safe-surface fields can land in
    # `captured.out` rather than our `buffer`. Check `combined`, the same
    # superset the leak assertions above use.
    assert "log-probe" in combined


def test_reset_requires_confirmation_phrase_400():
    sub = f"sk-{uuid.uuid4()}"
    asyncio.run(_make_account(sub))
    _as(sub)
    with TestClient(app) as c:
        assert c.delete(f"{SYNC}/data").status_code == 400
        assert c.delete(f"{SYNC}/data", params={"confirm": "yes"}).status_code == 400


def test_reset_wipes_keyset_then_new_keyset_allowed():
    sub = f"sk-{uuid.uuid4()}"
    asyncio.run(_make_account(sub))
    _as(sub)
    with TestClient(app) as c:
        assert c.put(f"{SYNC}/keyset", json=_keyset_body(b"before-reset")).status_code == 200
        assert c.put(f"{SYNC}/keyset", json=_keyset_body(b"again")).status_code == 409

        res = c.delete(f"{SYNC}/data", params={"confirm": "delete-all-synced-data"})
        assert res.status_code == 200
        assert res.json()["sync_keyset"] == 1
        assert c.get(f"{SYNC}/keyset").status_code == 404
        # Keyset gone, so a fresh one is accepted without force.
        assert c.put(f"{SYNC}/keyset", json=_keyset_body(b"after-reset")).status_code == 200


# ── account reset: scope + isolation (ADR-014 lost-recovery-key recovery) ───

RESET_CONFIRM = {"confirm": "delete-all-synced-data"}
_RESET_TABLES = ("sync_keyset", "synced_book", "synced_epub", "synced_shelves")


async def _row_counts(sub: str) -> dict[str, int]:
    """Raw row counts per sync table for one account (tombstones included)."""
    conn = await asyncpg.connect(DSN)
    try:
        acct = await conn.fetchval("SELECT id FROM account WHERE idp_sub = $1", sub)
        out: dict[str, int] = {}
        for table in _RESET_TABLES:
            out[table] = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE owner_account_id = $1", acct
            )
        return out
    finally:
        await conn.close()


def _epub_put(c: TestClient, epub_id: str, seed: bytes) -> None:
    # Raw ciphertext body; the nonce/tag/wrapped-key/meta travel as headers.
    r = c.put(
        f"{SYNC}/epubs/{epub_id}",
        content=b"epub-ct-" + seed,
        headers={
            "X-Nonce": _b64(seed + b"-epub-nonce"),
            "X-Tag": _b64(seed + b"-epub-tag-16b"),
            "X-Wrapped-Dk": _b64(seed + b"-epub-wdk"),
            "X-Dk-Nonce": _b64(seed + b"-epub-dknonce"),
            "X-Meta": _b64(seed + b"-epub-meta"),
            "X-Meta-Nonce": _b64(seed + b"-epub-meta-nonce"),
            "X-Client-Version": "v1",
            "Content-Type": "application/octet-stream",
        },
    )
    assert r.status_code == 200, r.text


def _fill_account(c: TestClient, seed: bytes) -> None:
    """Give the Principal currently set by _as() one of every synced artefact:
    a keyset, two books, one epub and a shelves blob."""
    assert c.put(f"{SYNC}/keyset", json=_keyset_body(seed)).status_code == 200
    assert c.put(f"{SYNC}/books/b1", json=_book_body(seed + b"-b1")).status_code == 200
    assert c.put(f"{SYNC}/books/b2", json=_book_body(seed + b"-b2")).status_code == 200
    _epub_put(c, "e1", seed)
    shelves = _book_body(seed + b"-shelves")
    assert c.put(f"{SYNC}/shelves", json=shelves).status_code == 200


def test_reset_wipes_every_synced_table_and_reports_exact_counts():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        _fill_account(c, b"scope")
        before = asyncio.run(_row_counts(sub))
        assert before == {"sync_keyset": 1, "synced_book": 2, "synced_epub": 1, "synced_shelves": 1}

        res = c.delete(f"{SYNC}/data", params=RESET_CONFIRM)
        assert res.status_code == 200
        # The response is per-table metadata counts, not content.
        assert res.json() == {
            "synced_book": 2,
            "synced_epub": 1,
            "synced_shelves": 1,
            "sync_keyset": 1,
        }

        # Hard delete: no tombstones left behind for any table.
        assert asyncio.run(_row_counts(sub)) == dict.fromkeys(_RESET_TABLES, 0)
        assert c.get(f"{SYNC}/keyset").status_code == 404
        assert c.get(f"{SYNC}/books").json() == []


def test_reset_leaves_other_accounts_completely_untouched():
    sub_a = f"sk-{uuid.uuid4()}"
    sub_b = f"sk-{uuid.uuid4()}"
    _account(sub_a)
    _account(sub_b)
    with TestClient(app) as c:
        _as(sub_b)
        _fill_account(c, b"bystander")
        b_counts = asyncio.run(_row_counts(sub_b))
        b_book_before = c.get(f"{SYNC}/books/b1").json()
        b_keyset_before = c.get(f"{SYNC}/keyset").json()
        assert b_counts == {
            "sync_keyset": 1,
            "synced_book": 2,
            "synced_epub": 1,
            "synced_shelves": 1,
        }

        _as(sub_a)
        _fill_account(c, b"victim")
        assert c.delete(f"{SYNC}/data", params=RESET_CONFIRM).status_code == 200
        assert asyncio.run(_row_counts(sub_a)) == dict.fromkeys(_RESET_TABLES, 0)

        # B's rows are byte-for-byte what they were: counts, the keyset, and a book.
        assert asyncio.run(_row_counts(sub_b)) == b_counts
        _as(sub_b)
        assert c.get(f"{SYNC}/books/b1").json() == b_book_before
        assert c.get(f"{SYNC}/keyset").json() == b_keyset_before
        assert len(c.get(f"{SYNC}/books").json()) == 2


def test_reset_on_account_with_no_sync_data_is_a_zero_count_noop():
    sub = f"sk-{uuid.uuid4()}"
    _account(sub)
    with TestClient(app) as c:
        _as(sub)
        res = c.delete(f"{SYNC}/data", params=RESET_CONFIRM)
        assert res.status_code == 200
        assert res.json() == dict.fromkeys(_RESET_TABLES, 0)
