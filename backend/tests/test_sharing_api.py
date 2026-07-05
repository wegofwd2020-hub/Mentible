"""Draft-sharing HTTP wiring: auth, status codes, owner-vs-invited authz. DB faked."""

from __future__ import annotations

import pytest

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


class _Conn:
    def __init__(self, access="owner", owner="author-1"):
        self._access = access
        self._owner = owner
        self.executed = []

    async def execute(self, sql, *a):
        self.executed.append((sql, a))

    async def fetchval(self, sql, *a):
        if "owner_sub FROM shared_draft" in sql:
            return self._owner
        if "FROM draft_invitation" in sql:
            return 1 if self._access == "invited" else None
        return None

    async def fetchrow(self, sql, *a):
        return None

    async def fetch(self, sql, *a):
        return []


class _Pool:
    def __init__(self, conn):
        self._c = conn

    def acquire(self):
        c = self._c

        class _Cm:
            async def __aenter__(self):
                return c

            async def __aexit__(self, *a):
                return False

        return _Cm()


@pytest.fixture
def as_user():
    def _set(sub="author-1", email="author@x.com", conn=None):
        app.dependency_overrides[require_user] = lambda: Principal(
            sub=sub, email=email, issuer="test"
        )
        app.state.db = _Pool(conn or _Conn())

    yield _set
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_share_requires_auth(as_user):
    from httpx import ASGITransport, AsyncClient

    app.state.db = _Pool(_Conn())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/drafts/b1/share",
            json={"title": "T", "version": "1.0", "book_json": {"id": "b1"}},
        )
    assert r.status_code == 401  # no override → require_user rejects


@pytest.mark.asyncio
async def test_add_invitation_owner_ok(as_user):
    from httpx import ASGITransport, AsyncClient

    as_user(sub="author-1", conn=_Conn(owner="author-1"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/invitations", json={"email": "Alice@x.com"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_add_invitation_non_owner_403(as_user):
    from httpx import ASGITransport, AsyncClient

    as_user(sub="intruder", conn=_Conn(owner="author-1"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/invitations", json={"email": "a@x.com"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_comment_empty_body_422(as_user):
    from httpx import ASGITransport, AsyncClient

    as_user(sub="author-1", conn=_Conn(owner="author-1", access="owner"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/comments", json={"version": "1.0", "body": "   "})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_my_drafts_requires_auth():
    from httpx import ASGITransport, AsyncClient

    app.state.db = _Pool(_Conn())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/drafts/mine")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_my_drafts_ok_returns_list(as_user):
    from httpx import ASGITransport, AsyncClient

    as_user(sub="author-1", conn=_Conn())  # _Conn.fetch returns [] → empty list, 200
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/drafts/mine")
    assert r.status_code == 200
    assert r.json() == []
