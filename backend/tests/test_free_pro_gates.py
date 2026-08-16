"""Free/Pro server-side enforcement — T2 (the 3 gates, all 402 Payment Required).

T1 (`test_billing_quota.py`) built `is_pro` / `quota.count_projects` /
`quota.count_generations` / `GET /billing/plan-status` — it only *computes*
where an account stands, never enforces. This file covers the 3 places that
actually refuse a Free-capped caller, BEFORE any side effect (job, envelope,
project row):

1. `trust.router.create_project` — a projects cap.
2. The 3 trust generate submits (`generate_version`, `generate_topic_version`,
   `suggest_project_toc`) — a rolling generations cap.
3. `export.router.submit_export` — an export Pro-wall, gated ONLY for an
   authenticated caller. The anonymous/public demo must NOT be gated (an
   explicit test below asserts this).

DB-gated (skipped without DATABASE_URL, like test_trust_router.py /
test_billing_quota.py) — the gates read real `project`/`topic_version`/
`artifact_version` rows via `quota.count_projects`/`count_generations`.
"""

from __future__ import annotations

import json as _json
import os
import uuid
from unittest.mock import patch

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import eligibility
from backend.src.core.redis_dep import get_redis
from backend.src.export import compiler
from backend.src.export.compiler import ExportResult

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")

_KEY = "sk-ant-" + "x" * 20


def _as(sub, email):
    """Override the trust router's owner/reviewer identity dependency."""
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


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
    staff allowlist (`_grant_pro`) — `is_pro` also checks an entitlement row,
    but the allowlist is the cheap, no-write way to flip Pro on/off per test."""
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())


def _grant_pro(monkeypatch, *, sub):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset({sub}))


def _artifact_with_source(c):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    art = c.post(
        f"/api/v1/trust/projects/{pid}/artifacts", json={"role": "cornerstone", "format": "guide"}
    ).json()
    c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"})
    return pid, art["id"]


def _project_with_toc_topic(c, topic_id="t1"):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    iid = c.post(
        f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"}
    ).json()["id"]
    toc = {
        "subjects": [
            {
                "subject_label": "S",
                "units": [
                    {
                        "id": topic_id,
                        "title": "T",
                        "subtopics": [],
                        "prerequisites": [],
                        "source_ids": [iid],
                    }
                ],
            }
        ]
    }
    assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200
    return pid, iid


# ── Gate 1: projects cap (create_project) ───────────────────────────────────


def test_project_create_402_at_free_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_projects", 1)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        r1 = c.post("/api/v1/trust/projects", json={"title": "P1"})
        assert r1.status_code == 200, r1.text
        r2 = c.post("/api/v1/trust/projects", json={"title": "P2"})
        assert r2.status_code == 402, r2.text
        assert "upgrade to Pro" in r2.json()["detail"]


def test_project_create_under_cap_ok(monkeypatch):
    monkeypatch.setattr(settings, "free_max_projects", 2)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        assert c.post("/api/v1/trust/projects", json={"title": "P1"}).status_code == 200
        assert c.post("/api/v1/trust/projects", json={"title": "P2"}).status_code == 200


def test_project_create_pro_bypasses_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_projects", 1)
    owner = f"o-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=owner)
    with TestClient(app) as c:
        _as(owner, f"{owner}@x.z")
        assert c.post("/api/v1/trust/projects", json={"title": "P1"}).status_code == 200
        assert c.post("/api/v1/trust/projects", json={"title": "P2"}).status_code == 200


# ── Gate 2: generations cap (the 3 trust generate submits) ─────────────────


def test_generate_version_402_at_free_gen_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 0)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, aid = _artifact_with_source(c)
        r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": _KEY})
        assert r.status_code == 402, r.text
        assert "upgrade to Pro" in r.json()["detail"]


def test_generate_version_under_cap_202(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 5)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, aid = _artifact_with_source(c)
        with patch("backend.src.trust.router.generate_version_task.delay"):
            r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": _KEY})
        assert r.status_code == 202, r.text


def test_generate_version_pro_bypasses_gen_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 0)
    owner = f"o-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=owner)
    with TestClient(app) as c:
        _as(owner, f"{owner}@x.z")
        _pid, aid = _artifact_with_source(c)
        with patch("backend.src.trust.router.generate_version_task.delay"):
            r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": _KEY})
        assert r.status_code == 202, r.text


def test_generate_topic_402_at_free_gen_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 0)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        r = c.post(f"/api/v1/trust/projects/{pid}/topics/t1/generate", json={"api_key": _KEY})
        assert r.status_code == 402, r.text
        assert "upgrade to Pro" in r.json()["detail"]


def test_generate_topic_under_cap_202(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 5)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        with patch("backend.src.trust.router.generate_topic_task.delay"):
            r = c.post(f"/api/v1/trust/projects/{pid}/topics/t1/generate", json={"api_key": _KEY})
        assert r.status_code == 202, r.text


def test_generate_topic_pro_bypasses_gen_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 0)
    owner = f"o-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=owner)
    with TestClient(app) as c:
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        with patch("backend.src.trust.router.generate_topic_task.delay"):
            r = c.post(f"/api/v1/trust/projects/{pid}/topics/t1/generate", json={"api_key": _KEY})
        assert r.status_code == 202, r.text


def test_suggest_toc_402_at_free_gen_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 0)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _aid = _artifact_with_source(c)
        r = c.post(f"/api/v1/trust/projects/{pid}/suggest-toc", json={"api_key": _KEY})
        assert r.status_code == 402, r.text
        assert "upgrade to Pro" in r.json()["detail"]


def test_suggest_toc_under_cap_202(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 5)
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _aid = _artifact_with_source(c)
        with patch("backend.src.trust.router.suggest_toc_task.delay"):
            r = c.post(f"/api/v1/trust/projects/{pid}/suggest-toc", json={"api_key": _KEY})
        assert r.status_code == 202, r.text


def test_suggest_toc_pro_bypasses_gen_cap(monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 0)
    owner = f"o-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=owner)
    with TestClient(app) as c:
        _as(owner, f"{owner}@x.z")
        pid, _aid = _artifact_with_source(c)
        with patch("backend.src.trust.router.suggest_toc_task.delay"):
            r = c.post(f"/api/v1/trust/projects/{pid}/suggest-toc", json={"api_key": _KEY})
        assert r.status_code == 202, r.text


# ── Gate 3: export Pro-wall (authenticated only — demo stays ungated) ──────

_BOOK = _json.dumps({"title": "T", "toc": {"subjects": []}})


async def _fake_compile(raw: bytes, *, fmt: str = "epub", diagrams: bool = False) -> ExportResult:
    return ExportResult(data=b"fake-bytes", title="T", warnings=[])


def test_export_authenticated_free_402():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export/jobs?format=epub", content=_BOOK)
        assert r.status_code == 402, r.text
        assert "export_epub" in r.json()["detail"]


def test_export_authenticated_pro_202(monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    sub = f"e-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=sub)
    with TestClient(app) as c:
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export/jobs?format=epub", content=_BOOK)
        assert r.status_code == 202, r.text


def test_export_anonymous_not_gated(monkeypatch):
    """The anonymous/public demo export MUST pass through ungated — no
    principal ⇒ no gate, regardless of Free/Pro. This is the load-bearing
    assertion: a bug here would 402 the demo."""
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    with TestClient(app) as c:
        app.dependency_overrides.pop(optional_user, None)  # no auth header, no override
        r = c.post("/api/v1/export/jobs?format=epub", content=_BOOK)
        assert r.status_code != 402
        assert r.status_code == 202, r.text


# ── Gate 3b: the legacy SYNC /export endpoint (same Pro-wall, no sibling gap) ─
#
# `export_book` (POST /api/v1/export, distinct from the async /export/jobs
# gated above) is the older synchronous handler. The mobile client only calls
# it for `format=cover` (mobile/src/api/client.ts exportCoverSync) — but epub
# and pdf are still live formats on it, and without this gate an authenticated
# Free user could get a full compiled book straight through this sibling
# endpoint, bypassing the /export/jobs Pro-wall entirely.


def test_sync_export_authenticated_free_402_epub():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=epub", content=_BOOK)
        assert r.status_code == 402, r.text
        assert "export_epub" in r.json()["detail"]


def test_sync_export_authenticated_free_402_pdf():
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=pdf", content=_BOOK)
        assert r.status_code == 402, r.text
        assert "export_pdf" in r.json()["detail"]


def test_sync_export_authenticated_pro_200(monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    sub = f"e-{uuid.uuid4()}"
    _grant_pro(monkeypatch, sub=sub)
    with TestClient(app) as c:
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=epub", content=_BOOK)
        assert r.status_code == 200, r.text


def test_sync_export_anonymous_not_gated(monkeypatch):
    """The anonymous/public demo sync export MUST pass through ungated too —
    mirrors test_export_anonymous_not_gated for /export/jobs."""
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    with TestClient(app) as c:
        app.dependency_overrides.pop(optional_user, None)  # no auth header, no override
        r = c.post("/api/v1/export?format=epub", content=_BOOK)
        assert r.status_code != 402
        assert r.status_code == 200, r.text


def test_sync_export_cover_never_gated_even_for_free_user(monkeypatch):
    """format=cover is a UI asset (mobile Library thumbnail, exportCoverSync),
    not a book download — it must NEVER be gated, even for an authenticated
    Free caller who WOULD be 402'd on epub/pdf."""
    monkeypatch.setattr(compiler, "compile_book", _fake_compile)
    with TestClient(app) as c:
        sub = f"e-{uuid.uuid4()}"
        _as_export_principal(sub, f"{sub}@x.z")
        r = c.post("/api/v1/export?format=cover", content=_BOOK)
        assert r.status_code != 402
        assert r.status_code == 200, r.text
