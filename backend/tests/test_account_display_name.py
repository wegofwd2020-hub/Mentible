"""Editable account display name (Author Commons account name). Real Postgres;
skipped when DATABASE_URL is unset."""

from __future__ import annotations

import json
import os

import asyncpg
import pytest
import pytest_asyncio

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.export import tasks as export_tasks
from backend.tests.test_library import _BOOK

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")]

SUB = "display-name-test-sub"
URL = "/api/v1/account/display-name"


@pytest_asyncio.fixture
async def pool():
    p = await asyncpg.create_pool(DSN, min_size=1, max_size=3)
    async with p.acquire() as c:
        await c.execute("DELETE FROM account WHERE idp_sub = $1", SUB)
    app.state.db = p
    principal = Principal(sub=SUB, email="dn@example.com", issuer="https://test")
    app.dependency_overrides[require_active_user] = lambda: principal
    app.dependency_overrides[require_user] = lambda: principal
    try:
        yield p
    finally:
        app.dependency_overrides.pop(require_active_user, None)
        app.dependency_overrides.pop(require_user, None)
        async with p.acquire() as c:
            await c.execute("DELETE FROM account WHERE idp_sub = $1", SUB)
        app.state.db = None
        await p.close()


async def test_get_is_null_by_default(client, pool):
    r = await client.get(URL)
    assert r.status_code == 200
    assert r.json() == {"display_name": None}


async def test_put_stores_trimmed_value(client, pool):
    r = await client.put(URL, json={"display_name": "  Ada L.  "})
    assert r.status_code == 200
    assert r.json() == {"display_name": "Ada L."}
    assert (await client.get(URL)).json() == {"display_name": "Ada L."}


@pytest.mark.parametrize("bad", ["", "   ", "\t\n"])
async def test_put_blank_is_422(client, pool, bad):
    r = await client.put(URL, json={"display_name": bad})
    assert r.status_code == 422


async def test_put_length_limit(client, pool):
    assert (await client.put(URL, json={"display_name": "x" * 60})).status_code == 200
    assert (await client.put(URL, json={"display_name": "x" * 61})).status_code == 422
    # the trimmed length is what counts
    assert (await client.put(URL, json={"display_name": " " + "x" * 60 + " "})).status_code == 200


async def _publish(client, monkeypatch):
    seen = []

    async def fake_run_export(**kwargs):
        seen.append(kwargs)

    monkeypatch.setattr(export_tasks, "run_export", fake_run_export)
    resp = await client.post(
        "/api/v1/library/dn-book-1/publish?format=epub", content=json.dumps(_BOOK)
    )
    return resp, seen


async def test_publish_blocked_without_display_name(client, pool, monkeypatch):
    resp, seen = await _publish(client, monkeypatch)
    assert resp.status_code == 422
    assert "Missing required fields" in resp.json()["detail"]
    assert "account_name" in resp.json()["detail"]
    assert seen == []


async def test_publish_blocked_when_stored_name_is_whitespace(client, pool, monkeypatch):
    await client.get(URL)  # provisions the account row
    async with pool.acquire() as c:
        await c.execute("UPDATE account SET display_name = '   ' WHERE idp_sub = $1", SUB)
    resp, _ = await _publish(client, monkeypatch)
    assert resp.status_code == 422
    assert "account_name" in resp.json()["detail"]


async def test_publish_passes_with_display_name(client, pool, monkeypatch):
    await client.put(URL, json={"display_name": "Ada L."})
    try:
        resp, seen = await _publish(client, monkeypatch)
        assert resp.status_code == 202
        assert seen[0]["commons"]["account_name"] == "Ada L."
    finally:
        async with pool.acquire() as c:
            await c.execute("DELETE FROM published_book_owner WHERE book_id = 'dn-book-1'")
