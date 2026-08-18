"""docx export format wiring + the per-feature (`has_feature`) export gate (T4).

Task 3 added `export_docx` to `plans.EXPORT_FEATURES` (both plans carry all three
export flags) and `billing.access.has_feature` / `billing.quota.feature_required`.
This file covers the router wiring that actually accepts `format=docx` and gates
it the same way epub/pdf are gated — mirrors the harness in
`test_free_pro_gates.py`'s "Gate 3" section (same dependency-override pattern,
same staff-allowlist `_grant_pro` helper, same anonymous/no-DB-gate discipline).

DB-gated (skipped without DATABASE_URL) — `has_feature` reads the account's
active entitlement / staff-allowlist status via real DB calls.
"""

from __future__ import annotations

import json as _json
import os
import uuid

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import eligibility
from backend.src.core.redis_dep import get_redis
from backend.src.export import compiler
from backend.src.export.compiler import ExportResult

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")

_BOOK = _json.dumps({"title": "T", "toc": {"subjects": []}})


def _as_export_principal(sub, email):
    """Override the export router's optional identity dependency."""
    app.dependency_overrides[optional_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _redis():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=False)
    app.dependency_overrides[get_redis] = lambda: fake
    yield fake


@pytest.fixture(autouse=True)
def _free_by_default(monkeypatch):
    """Nobody in this file is Pro unless a test explicitly grants it via the
    staff allowlist (`_grant_pro`)."""
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())


def _grant_pro(monkeypatch, *, sub):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset({sub}))


async def _fake_compile(
    raw: bytes, *, fmt: str = "docx", diagrams: bool = False, profile: str = "default"
) -> ExportResult:
    return ExportResult(data=b"fake-bytes", title="T", warnings=[])


def test_docx_submit_202_for_entitled(monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    sub = f"e-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=sub)
    with TestClient(app) as c:
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export/jobs?format=docx", content=_BOOK)
        assert r.status_code == 202, r.text


def test_docx_submit_402_for_free():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export/jobs?format=docx", content=_BOOK)
        assert r.status_code == 402, r.text
        assert "export_docx" in r.json()["detail"]


def test_unknown_format_still_422_async():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export/jobs?format=rtf", content=_BOOK)
        assert r.status_code == 422, r.text


def test_unknown_format_still_422_sync():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=rtf", content=_BOOK)
        assert r.status_code == 422, r.text


def test_sync_docx_402_for_free():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=docx", content=_BOOK)
        assert r.status_code == 402, r.text
        assert "export_docx" in r.json()["detail"]


def test_sync_docx_200_for_entitled(monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    sub = f"e-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=sub)
    with TestClient(app) as c:
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=docx", content=_BOOK)
        assert r.status_code == 200, r.text


def test_cover_stays_ungated_for_free_user(monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=cover", content=_BOOK)
        assert r.status_code != 402
        assert r.status_code == 200, r.text


def test_cover_stays_ungated_anonymous(monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    with TestClient(app) as c:
        app.dependency_overrides.pop(optional_user, None)  # no auth header, no override
        r = c.post("/api/v1/export?format=cover", content=_BOOK)
        assert r.status_code != 402
        assert r.status_code == 200, r.text
