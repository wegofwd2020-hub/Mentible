"""Tests for the Open Library endpoints (publish / public metadata / gated
download) and the artifact store. The compiler + DB are faked so these run
without Node or Postgres.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.export import compiler
from backend.src.export.compiler import ExportResult
from backend.src.library import artifact_store

_BOOK = {
    "id": "book-1",
    "title": "Physics & Friends",
    "toc": {"subjects": [{"subject_label": "M", "units": [{"id": "u1", "title": "K"}]}]},
    "content": {},
}


# ── fakes ────────────────────────────────────────────────────────────────────
class _RecordingConn:
    def __init__(self, rows=None):
        self.executed: list[tuple] = []
        self._rows = rows or []

    async def execute(self, sql, *args):
        self.executed.append((sql, args))

    async def fetch(self, sql, *args):
        return self._rows

    async def fetchrow(self, sql, *args):
        return self._rows[0] if self._rows else None


class _Pool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        conn = self._conn

        class _CM:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return _CM()


def _fake_compile(data=b"PK-epub"):
    async def fake(raw, *, fmt="epub", diagrams=False):
        return ExportResult(data=data, title="Physics & Friends", warnings=[])

    return fake


async def _wait_done(client, job_id):
    for _ in range(200):
        body = (await client.get(f"/api/v1/export/jobs/{job_id}")).json()
        if body.get("status") in ("done", "failed"):
            return body
        await asyncio.sleep(0.02)
    raise AssertionError("job never finished")


@pytest.fixture
def as_user():
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="author-1", email="a@x.com", issuer="iss"
    )
    yield
    app.dependency_overrides.pop(require_user, None)


# ── artifact store (pure filesystem) ─────────────────────────────────────────
def test_artifact_store_round_trip(tmp_path, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "artifact_store_dir", str(tmp_path))
    path = artifact_store.store_artifact("book-1", "pdf", b"%PDF-data")
    assert artifact_store.read_artifact(path) == b"%PDF-data"
    assert artifact_store.content_hash(b"%PDF-data").startswith("sha256:")
    # a missing file reads back as None, not an exception
    assert artifact_store.read_artifact(str(tmp_path / "nope")) is None


def test_artifact_path_sanitises_book_id(tmp_path, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "artifact_store_dir", str(tmp_path))
    p = artifact_store.store_artifact("../../etc/passwd", "epub", b"x")
    # the traversal is neutralised — the file stays under the store dir
    assert str(tmp_path) in p and "/etc/passwd" not in p


# ── publish → hosts + registers ──────────────────────────────────────────────
async def test_publish_compiles_then_stores_and_registers(client, tmp_path, monkeypatch, as_user):
    from backend.config import settings

    monkeypatch.setattr(settings, "artifact_store_dir", str(tmp_path))
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(b"PK-epub-bytes"))
    conn = _RecordingConn()
    app.state.db = _Pool(conn)
    try:
        submit = await client.post("/api/v1/library/book-1/publish?format=epub", content=json.dumps(_BOOK))
        assert submit.status_code == 202
        body = await _wait_done(client, submit.json()["job_id"])
    finally:
        app.state.db = None

    assert body["status"] == "done"
    assert body["published"] is True
    # the file landed in the store …
    assert artifact_store.read_artifact(artifact_store.artifact_path("book-1", "epub")) == b"PK-epub-bytes"
    # … and a registry upsert ran
    assert any("published_artifact" in sql for sql, _ in conn.executed)


async def test_publish_requires_a_configured_store(client, as_user):
    app.state.db = None
    resp = await client.post("/api/v1/library/book-1/publish?format=epub", content=json.dumps(_BOOK))
    assert resp.status_code == 503


async def test_publish_rejects_unknown_format(client, as_user):
    resp = await client.post("/api/v1/library/book-1/publish?format=mobi", content=json.dumps(_BOOK))
    assert resp.status_code == 422


async def test_publish_requires_auth(client):
    # no require_user override → anonymous → 401/403
    resp = await client.post("/api/v1/library/book-1/publish?format=epub", content=json.dumps(_BOOK))
    assert resp.status_code in (401, 403)


# ── public metadata + gated download ─────────────────────────────────────────
async def test_artifacts_metadata_is_public_and_empty_without_store(client):
    app.state.db = None
    resp = await client.get("/api/v1/library/book-1/artifacts")
    assert resp.status_code == 200
    assert resp.json() == {}


async def test_artifacts_metadata_lists_published_formats(client):
    from datetime import UTC, datetime

    row = {
        "book_id": "book-1",
        "format": "epub",
        "content_hash": "sha256:abc",
        "size_bytes": 123,
        "filename": "x.epub",
        "storage_path": "/nope",
        "published_by_sub": "author-1",
        "published_at": datetime(2026, 7, 4, tzinfo=UTC),
    }
    app.state.db = _Pool(_RecordingConn(rows=[row]))
    try:
        resp = await client.get("/api/v1/library/book-1/artifacts")
    finally:
        app.state.db = None
    assert resp.status_code == 200
    assert resp.json()["epub"]["size_bytes"] == 123


async def test_download_requires_auth(client):
    resp = await client.get("/api/v1/library/book-1/artifacts/epub")
    assert resp.status_code in (401, 403)


async def test_download_404_when_not_published(client, as_user):
    app.state.db = _Pool(_RecordingConn(rows=[]))
    try:
        resp = await client.get("/api/v1/library/book-1/artifacts/epub")
    finally:
        app.state.db = None
    assert resp.status_code == 404


async def test_download_streams_the_file(client, tmp_path, monkeypatch, as_user):
    from datetime import UTC, datetime

    from backend.config import settings

    monkeypatch.setattr(settings, "artifact_store_dir", str(tmp_path))
    path = artifact_store.store_artifact("book-1", "pdf", b"%PDF-hello")
    row = {
        "book_id": "book-1",
        "format": "pdf",
        "content_hash": "sha256:abc",
        "size_bytes": 10,
        "filename": "physics.pdf",
        "storage_path": path,
        "published_by_sub": "author-1",
        "published_at": datetime(2026, 7, 4, tzinfo=UTC),
    }
    app.state.db = _Pool(_RecordingConn(rows=[row]))
    try:
        resp = await client.get("/api/v1/library/book-1/artifacts/pdf")
    finally:
        app.state.db = None
    assert resp.status_code == 200
    assert resp.content == b"%PDF-hello"
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.headers["content-disposition"] == 'attachment; filename="physics.pdf"'
