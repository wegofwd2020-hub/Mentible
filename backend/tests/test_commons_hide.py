"""Owner-only hide route and download-respects-status, against a real Postgres.
Skipped when DATABASE_URL is unset."""

from __future__ import annotations

import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

from backend.config import settings
from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.library import artifact_store, commons_repo, published_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")]

OWNER = "owner-1"


@pytest.fixture
def book_id():
    return f"hide-{uuid.uuid4().hex[:12]}"


@pytest_asyncio.fixture
async def pool(book_id, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "artifact_store_dir", str(tmp_path))
    p = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
    app.state.db = p
    try:
        yield p
    finally:
        async with p.acquire() as c:
            await c.execute("DELETE FROM author_commons_entry WHERE book_id = $1", book_id)
            await c.execute("DELETE FROM published_artifact WHERE book_id = $1", book_id)
        app.state.db = None
        await p.close()


def _as(sub):
    app.dependency_overrides[require_user] = lambda: Principal(
        sub=sub, email=f"{sub}@x.com", issuer="iss"
    )


@pytest.fixture(autouse=True)
def _clear_override():
    yield
    app.dependency_overrides.pop(require_user, None)


async def _publish(pool, book_id, *, bump=True):
    path = artifact_store.store_artifact(book_id, "epub", b"epub-bytes")
    async with pool.acquire() as c:
        await published_repo.upsert(
            c,
            book_id=book_id,
            fmt="epub",
            content_hash=artifact_store.content_hash(b"epub-bytes"),
            size_bytes=10,
            filename="book.epub",
            storage_path=path,
            published_by_sub=OWNER,
        )
        entry = await commons_repo.upsert_publish(
            c,
            book_id=book_id,
            owner_sub=OWNER,
            title="T",
            author_name="Ada",
            account_name="acme",
            description=None,
            language="en",
            cover_svg=None,
            fmt="epub",
            bump_version=bump,
        )
    return path, entry


async def _entry(pool, book_id):
    async with pool.acquire() as c:
        return await commons_repo.get_entry(c, book_id)


async def test_hide_by_owner_sets_hidden(client, pool, book_id):
    await _publish(pool, book_id)
    _as(OWNER)
    resp = await client.post(f"/api/v1/library/{book_id}/hide")
    assert resp.status_code == 200
    assert resp.json() == {"status": "hidden"}
    assert (await _entry(pool, book_id)).status == "hidden"


async def test_hide_by_non_owner_is_403(client, pool, book_id):
    await _publish(pool, book_id)
    _as("someone-else")
    resp = await client.post(f"/api/v1/library/{book_id}/hide")
    assert resp.status_code == 403
    assert (await _entry(pool, book_id)).status == "live"


async def test_hide_unknown_book_is_404(client, pool, book_id):
    _as(OWNER)
    resp = await client.post(f"/api/v1/library/{book_id}/hide")
    assert resp.status_code == 404


async def test_download_after_hide_is_404(client, pool, book_id):
    await _publish(pool, book_id)
    _as("reader-1")
    ok = await client.get(f"/api/v1/library/{book_id}/artifacts/epub")
    assert ok.status_code == 200 and ok.content == b"epub-bytes"
    _as(OWNER)
    await client.post(f"/api/v1/library/{book_id}/hide")
    _as("reader-1")
    resp = await client.get(f"/api/v1/library/{book_id}/artifacts/epub")
    assert resp.status_code == 404


async def test_hide_keeps_stored_files(client, pool, book_id):
    path, _ = await _publish(pool, book_id)
    _as(OWNER)
    await client.post(f"/api/v1/library/{book_id}/hide")
    assert artifact_store.read_artifact(path) == b"epub-bytes"
    async with pool.acquire() as c:
        assert await published_repo.get_one(c, book_id, "epub") is not None


async def test_republish_after_hide_is_live_and_bumps(client, pool, book_id):
    await _publish(pool, book_id)
    _as(OWNER)
    await client.post(f"/api/v1/library/{book_id}/hide")
    _, entry = await _publish(pool, book_id, bump=True)
    assert entry.status == "live" and entry.version == 2 and entry.owner_sub == OWNER
