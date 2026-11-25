"""Publish metadata gate: title, author and account name are required."""

from __future__ import annotations

import json

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.export import tasks as export_tasks
from backend.src.library import router as library_router
from backend.src.library.commons_metadata import missing_publish_fields
from backend.tests.test_library import _BOOK, _acme, _Pool, _RecordingConn


def _book(**over):
    book = {"title": "T", "metadata": {"author": "A"}}
    book.update(over)
    return book


def test_all_present_returns_empty():
    assert missing_publish_fields(_book(), "Acme") == []


def test_missing_author_reported():
    assert missing_publish_fields(_book(metadata={}), "Acme") == ["author"]


def test_whitespace_author_is_missing():
    assert missing_publish_fields(_book(metadata={"author": "   "}), "Acme") == ["author"]


def test_missing_title_and_account_reported_together():
    assert missing_publish_fields(_book(title=" "), None) == ["title", "account_name"]


async def test_publish_refused_422_without_author(client, monkeypatch):
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="author-1", email="a@x.com", issuer="iss"
    )
    monkeypatch.setattr(library_router, "_publish_account_name", _acme)
    called = []

    async def fake_run_export(**kwargs):
        called.append(kwargs)

    monkeypatch.setattr(export_tasks, "run_export", fake_run_export)
    no_author = {k: v for k, v in _BOOK.items() if k != "metadata"}
    conn = _RecordingConn()
    app.state.db = _Pool(conn)
    try:
        resp = await client.post(
            "/api/v1/library/book-1/publish?format=epub", content=json.dumps(no_author)
        )
    finally:
        app.state.db = None
        app.dependency_overrides.pop(require_user, None)
    assert resp.status_code == 422
    assert "Add the author's name" in resp.json()["detail"]
    assert called == []
    assert conn.executed == []


# --- size / type caps (security: resource exhaustion) ---------------------------------


def test_oversize_values_reported_by_field():
    from backend.src.library.commons_metadata import oversize_publish_fields

    ok = _book(metadata={"author": "A", "coverSvg": "x" * 100_000, "description": "d" * 5_000})
    assert oversize_publish_fields({**ok, "title": "t" * 300}) is None
    assert "coverSvg" in oversize_publish_fields(
        _book(metadata={"author": "A", "coverSvg": "x" * 100_001})
    )
    assert "description" in oversize_publish_fields(
        _book(metadata={"author": "A", "description": "d" * 5_001})
    )
    assert "title" in oversize_publish_fields(_book(title="t" * 301))
    assert "author" in oversize_publish_fields(_book(metadata={"author": "a" * 301}))
    assert "coverSvg" in oversize_publish_fields(_book(metadata={"author": "A", "coverSvg": 5}))
    assert "description" in oversize_publish_fields(
        _book(metadata={"author": "A", "description": ["x"]})
    )


async def _publish(client, monkeypatch, book):
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="author-1", email="a@x.com", issuer="iss"
    )
    monkeypatch.setattr(library_router, "_publish_account_name", _acme)

    async def fake_run_export(**kwargs):
        pass

    monkeypatch.setattr(export_tasks, "run_export", fake_run_export)
    app.state.db = _Pool(_RecordingConn())
    try:
        return await client.post(
            "/api/v1/library/book-1/publish?format=epub", content=json.dumps(book)
        )
    finally:
        app.state.db = None
        app.dependency_overrides.pop(require_user, None)


def _with_meta(**meta):
    return {**_BOOK, "metadata": {"author": "Ada", **meta}}


async def test_publish_422_oversize_cover_svg(client, monkeypatch):
    resp = await _publish(client, monkeypatch, _with_meta(coverSvg="x" * 100_001))
    assert resp.status_code == 422 and "coverSvg" in resp.json()["detail"]


async def test_publish_422_oversize_description(client, monkeypatch):
    resp = await _publish(client, monkeypatch, _with_meta(description="d" * 5_001))
    assert resp.status_code == 422 and "description" in resp.json()["detail"]


async def test_publish_422_oversize_title(client, monkeypatch):
    resp = await _publish(client, monkeypatch, {**_with_meta(), "title": "t" * 301})
    assert resp.status_code == 422 and "title" in resp.json()["detail"]


async def test_publish_at_limit_passes_gate(client, monkeypatch):
    book = {**_with_meta(coverSvg="x" * 100_000, description="d" * 5_000), "title": "t" * 300}
    resp = await _publish(client, monkeypatch, book)
    assert resp.status_code == 202
