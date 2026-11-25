"""run_export writes the Author Commons catalog row when a publish completes.
Real Postgres; the compiler and artifact store are stubbed. Skipped when
DATABASE_URL is unset."""

from __future__ import annotations

import json
import os
import uuid

import asyncpg
import pytest

from backend.src.export import compiler
from backend.src.export import tasks as export_tasks
from backend.src.library import artifact_store, commons_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")]


class _FakeRedis:
    def __init__(self):
        self.store: dict = {}

    async def set(self, key, value, ex=None):
        self.store[key] = value


@pytest.fixture
async def pool():
    p = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
    try:
        yield p
    finally:
        await p.close()


@pytest.fixture
def book_id(pool):
    return f"hook-{uuid.uuid4().hex[:12]}"


@pytest.fixture(autouse=True)
def stubs(monkeypatch):
    async def fake_compile(raw, *, fmt, diagrams, profile="default"):
        return compiler.ExportResult(data=b"bytes-" + fmt.encode(), title="Algebra", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake_compile)
    monkeypatch.setattr(
        artifact_store, "store_artifact", lambda bid, fmt, data: f"/tmp/{bid}.{fmt}"
    )


@pytest.fixture(autouse=True)
async def cleanup(pool, book_id):
    yield
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM author_commons_entry WHERE book_id = $1", book_id)
        await conn.execute("DELETE FROM published_artifact WHERE book_id = $1", book_id)


def _commons(fmt):
    return {
        "owner_sub": "owner-1",
        "title": "Algebra",
        "author_name": "Ada",
        "account_name": "ada",
        "description": "d",
        "language": "en",
        "cover_svg": "<svg/>",
        "bump_version": fmt == "epub",
    }


async def _run(pool, book_id, fmt, redis, commons=True):
    job_id = uuid.uuid4()
    await export_tasks.run_export(
        job_id=job_id,
        raw_book=json.dumps({"title": "Algebra"}).encode(),
        fmt=fmt,
        diagrams=False,
        redis_client=redis,
        publish_book_id=book_id,
        published_by_sub="owner-1",
        db_pool=pool,
        commons=_commons(fmt) if commons else None,
    )
    return json.loads(redis.store[export_tasks.export_status_key(job_id)])


async def _entry(pool, book_id):
    async with pool.acquire() as conn:
        return await commons_repo.get_entry(conn, book_id)


async def test_epub_publish_creates_entry_v1(pool, book_id):
    status = await _run(pool, book_id, "epub", _FakeRedis())
    assert status["status"] == "done" and status["published"] is True
    e = await _entry(pool, book_id)
    assert e.status == "live" and e.version == 1 and e.formats == ["epub"]
    assert e.cover_svg == "<svg/>" and e.account_name == "ada"
    assert status["listed"] is True


async def test_epub_then_pdf_is_one_publish(pool, book_id):
    await _run(pool, book_id, "epub", _FakeRedis())
    await _run(pool, book_id, "pdf", _FakeRedis())
    e = await _entry(pool, book_id)
    assert e.version == 1 and e.formats == ["epub", "pdf"]


async def test_no_commons_argument_writes_no_entry(pool, book_id):
    await _run(pool, book_id, "epub", _FakeRedis(), commons=False)
    assert await _entry(pool, book_id) is None


async def test_catalog_failure_does_not_fail_artifact(pool, book_id, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("catalog down")

    monkeypatch.setattr(commons_repo, "upsert_publish", boom)
    status = await _run(pool, book_id, "epub", _FakeRedis())
    assert status["status"] == "done" and status["published"] is True
    assert status["listed"] is False
    async with pool.acquire() as conn:
        n = await conn.fetchval("SELECT count(*) FROM published_artifact WHERE book_id=$1", book_id)
    assert n == 1
    assert await _entry(pool, book_id) is None


@pytest.mark.parametrize("fmt,bump", [("epub", True), ("pdf", False)])
async def test_router_builds_commons_and_bumps_only_for_epub(client, monkeypatch, fmt, bump):
    from backend.main import app
    from backend.src.auth.deps import require_user
    from backend.src.auth.principal import Principal
    from backend.src.library import router as library_router
    from backend.tests.test_library import _BOOK, _acme, _Pool, _RecordingConn

    app.dependency_overrides[require_user] = lambda: Principal(
        sub="author-1", email="a@x.com", issuer="iss"
    )
    monkeypatch.setattr(library_router, "_publish_account_name", _acme)
    seen = []

    async def fake_run_export(**kwargs):
        seen.append(kwargs)

    monkeypatch.setattr(export_tasks, "run_export", fake_run_export)
    book = {**_BOOK, "metadata": {"author": "Ada", "coverSvg": "<svg/>", "language": "en"}}
    app.state.db = _Pool(_RecordingConn())
    try:
        resp = await client.post(
            f"/api/v1/library/book-1/publish?format={fmt}", content=json.dumps(book)
        )
    finally:
        app.state.db = None
        app.dependency_overrides.pop(require_user, None)
    assert resp.status_code == 202
    c = seen[0]["commons"]
    assert c["bump_version"] is bump
    assert c["owner_sub"] == "author-1" and c["author_name"] == "Ada"
    assert c["account_name"] == "Acme" and c["cover_svg"] == "<svg/>"


# --- language: default "en", length cap, tag shape ------------------------------------


async def _post_publish(client, monkeypatch, metadata):
    from backend.main import app
    from backend.src.auth.deps import require_user
    from backend.src.auth.principal import Principal
    from backend.src.library import router as library_router
    from backend.tests.test_library import _BOOK, _acme, _Pool, _RecordingConn

    app.dependency_overrides[require_user] = lambda: Principal(
        sub="author-1", email="a@x.com", issuer="iss"
    )
    monkeypatch.setattr(library_router, "_publish_account_name", _acme)
    seen = []

    async def fake_run_export(**kwargs):
        seen.append(kwargs)

    monkeypatch.setattr(export_tasks, "run_export", fake_run_export)
    book = {**_BOOK, "metadata": {"author": "Ada", **metadata}}
    app.state.db = _Pool(_RecordingConn())
    try:
        resp = await client.post(
            "/api/v1/library/book-1/publish?format=epub", content=json.dumps(book)
        )
    finally:
        app.state.db = None
        app.dependency_overrides.pop(require_user, None)
    return resp, seen


async def test_missing_language_publishes_as_en_and_lists_under_english(
    client, monkeypatch, pool, book_id
):
    resp, seen = await _post_publish(client, monkeypatch, {})
    assert resp.status_code == 202
    commons = seen[0]["commons"]
    assert commons["language"] == "en"
    async with pool.acquire() as conn:
        await commons_repo.upsert_publish(conn, book_id=book_id, fmt="epub", **commons)
        _items, total = await commons_repo.list_live(
            conn, query="", language="en", limit=20, offset=0
        )
    assert total >= 1


async def test_empty_language_defaults_to_en(client, monkeypatch):
    resp, seen = await _post_publish(client, monkeypatch, {"language": "  "})
    assert resp.status_code == 202 and seen[0]["commons"]["language"] == "en"


async def test_language_tag_passes(client, monkeypatch):
    resp, seen = await _post_publish(client, monkeypatch, {"language": "en-US"})
    assert resp.status_code == 202 and seen[0]["commons"]["language"] == "en-US"


async def test_language_too_long_is_422(client, monkeypatch):
    resp, seen = await _post_publish(client, monkeypatch, {"language": "a" * 36})
    assert resp.status_code == 422 and seen == []


async def test_language_not_a_tag_is_422(client, monkeypatch):
    resp, seen = await _post_publish(client, monkeypatch, {"language": "not a tag!"})
    assert resp.status_code == 422 and seen == []
