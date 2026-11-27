"""Author Commons listing + detail endpoints against a real Postgres.
Skipped when DATABASE_URL is unset."""

from __future__ import annotations

import os

import asyncpg
import pytest
import pytest_asyncio

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.library import commons_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")]

_IDS = ("rt-live", "rt-hidden", "rt-other")


@pytest_asyncio.fixture
async def pool():
    p = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
    async with p.acquire() as c:
        await c.execute("DELETE FROM author_commons_entry WHERE book_id = ANY($1)", list(_IDS))
    app.state.db = p
    try:
        yield p
    finally:
        async with p.acquire() as c:
            await c.execute("DELETE FROM author_commons_entry WHERE book_id = ANY($1)", list(_IDS))
        app.state.db = None
        await p.close()


@pytest.fixture
def as_user():
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="reader-1", email="r@x.com", issuer="iss"
    )
    yield
    app.dependency_overrides.pop(require_user, None)


async def _pub(pool, book_id, title, author="Ada Author"):
    async with pool.acquire() as c:
        return await commons_repo.upsert_publish(
            c,
            book_id=book_id,
            owner_sub="owner-1",
            title=title,
            author_name=author,
            account_name="acme",
            description="A description",
            language="en",
            cover_svg="<svg/>",
            fmt="epub",
            bump_version=True,
        )


async def _hide(pool, book_id):
    async with pool.acquire() as c:
        await commons_repo.set_status(c, book_id=book_id, status="hidden")


async def test_listing_requires_sign_in(client, pool):
    resp = await client.get("/api/v1/author-commons")
    assert resp.status_code == 401


async def test_listing_returns_only_live(client, pool, as_user):
    await _pub(pool, "rt-live", "Live Book")
    await _pub(pool, "rt-hidden", "Hidden Book")
    await _hide(pool, "rt-hidden")
    resp = await client.get("/api/v1/author-commons", params={"query": "Book"})
    assert resp.status_code == 200
    body = resp.json()
    assert [i["book_id"] for i in body["items"]] == ["rt-live"]
    assert body["total"] == 1 and body["page"] == 1 and body["page_size"] == 20
    item = body["items"][0]
    assert item["cover_svg"] == "<svg/>" and item["formats"] == ["epub"]
    assert "description" not in item


async def test_empty_query_lists_all_live(client, pool, as_user):
    await _pub(pool, "rt-live", "Live Book")
    await _pub(pool, "rt-other", "Other Thing")
    resp = await client.get("/api/v1/author-commons")
    ids = {i["book_id"] for i in resp.json()["items"]}
    assert {"rt-live", "rt-other"} <= ids


async def test_search_matches_title_and_author_case_insensitive(client, pool, as_user):
    await _pub(pool, "rt-live", "Quantum Gardening", author="Zed")
    await _pub(pool, "rt-other", "Other", author="Quantum Qux")
    by_title = await client.get("/api/v1/author-commons", params={"query": "QUANTUM gard"})
    assert [i["book_id"] for i in by_title.json()["items"]] == ["rt-live"]
    by_author = await client.get("/api/v1/author-commons", params={"query": "qux"})
    assert [i["book_id"] for i in by_author.json()["items"]] == ["rt-other"]


async def test_wildcard_query_is_literal(client, pool, as_user):
    await _pub(pool, "rt-live", "Plain Title")
    resp = await client.get("/api/v1/author-commons", params={"query": "%"})
    assert resp.json()["total"] == 0 and resp.json()["items"] == []


async def test_detail_returns_description(client, pool, as_user):
    await _pub(pool, "rt-live", "Live Book")
    resp = await client.get("/api/v1/author-commons/rt-live")
    assert resp.status_code == 200
    assert resp.json()["description"] == "A description"
    assert resp.json()["title"] == "Live Book"


async def test_detail_404_for_hidden(client, pool, as_user):
    await _pub(pool, "rt-hidden", "Hidden Book")
    await _hide(pool, "rt-hidden")
    assert (await client.get("/api/v1/author-commons/rt-hidden")).status_code == 404
    assert (await client.get("/api/v1/author-commons/nope")).status_code == 404


async def test_my_listings_returns_only_caller_live_books(client, pool):
    # Owner is "owner-1" (see _pub); the test user is someone else, then the owner.
    await _pub(pool, "rt-live", "Mine Live")
    await _pub(pool, "rt-hidden", "Mine Hidden")
    await _hide(pool, "rt-hidden")
    await _pub(pool, "rt-other", "Someone Else")
    async with pool.acquire() as c:
        await c.execute(
            "UPDATE author_commons_entry SET owner_sub = 'other-9' WHERE book_id = 'rt-other'"
        )
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="owner-1", email="o@x.com", issuer="iss"
    )
    try:
        resp = await client.get("/api/v1/author-commons/mine")
    finally:
        app.dependency_overrides.pop(require_user, None)
    assert resp.status_code == 200
    assert [i["book_id"] for i in resp.json()] == ["rt-live"]


async def test_my_listings_requires_sign_in(client, pool):
    resp = await client.get("/api/v1/author-commons/mine")
    assert resp.status_code == 401
