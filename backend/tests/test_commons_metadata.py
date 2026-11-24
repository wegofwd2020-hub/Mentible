"""Publish metadata gate: title, author and account name are required."""

from __future__ import annotations

import json

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.export import tasks as export_tasks
from backend.src.library import router as library_router
from backend.src.library.commons_metadata import missing_publish_fields
from backend.tests.test_library import _BOOK, _Pool, _RecordingConn


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
    monkeypatch.setattr(library_router, "_publish_account_name", lambda principal: "Acme")
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
    assert "author" in resp.json()["detail"]
    assert called == []
    assert conn.executed == []
