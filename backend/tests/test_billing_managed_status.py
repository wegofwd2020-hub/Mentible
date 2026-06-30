"""Account-facing managed status endpoint — Phase 5 (ADR-005 D6).

GET /api/v1/billing/managed-status — the data the client meter renders. Offline: the
account/entitlement/usage repos are patched and a fake pool backs get_conn.
"""

from __future__ import annotations

import uuid

import pytest

from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans, usage_repo
from backend.src.billing.entitlement_repo import Entitlement

MANAGED_STATUS = "/api/v1/billing/managed-status"


class _FakeConn:
    pass


class _FakePool:
    def acquire(self):
        class _CM:
            async def __aenter__(self):
                return _FakeConn()

            async def __aexit__(self, *exc):
                return False

        return _CM()


@pytest.fixture(autouse=True)
def _isolate_db_state():
    from backend.main import app

    prior = getattr(app.state, "db", None)
    app.state.db = None
    yield
    app.state.db = prior


@pytest.fixture
def as_user():
    """Override require_active_user → a fixed verified principal."""
    from backend.main import app
    from backend.src.accounts.deps import require_active_user

    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub="u1", email="u1@x.com", issuer="https://test"
    )
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_active_user, None)


def _patch_account(monkeypatch):
    from backend.src.accounts import repo as accounts_repo

    class _Acct:
        id = uuid.uuid4()

    async def _get_or_create(conn, **kw):
        return _Acct()

    monkeypatch.setattr(accounts_repo, "get_or_create_account", _get_or_create)


def _patch_usage(monkeypatch, cost_micros: int):
    async def _usage(conn, **kw):
        return usage_repo.PeriodUsage(
            input_tokens=10, output_tokens=20, cost_micros=cost_micros, events=1
        )

    monkeypatch.setattr(usage_repo, "period_usage", _usage)


@pytest.mark.asyncio
async def test_no_entitlement_is_byok(client, as_user, monkeypatch):
    from backend.main import app

    _patch_account(monkeypatch)
    _patch_usage(monkeypatch, 0)

    async def _no_ent(conn, **kw):
        return None

    monkeypatch.setattr(entitlement_repo, "get_entitlement", _no_ent)
    app.state.db = _FakePool()

    r = await client.get(MANAGED_STATUS)
    assert r.status_code == 200
    body = r.json()
    assert body["entitlement"] is None
    assert body["allowance_micros"] is None
    assert body["usage"]["cost_micros"] == 0


@pytest.mark.asyncio
async def test_active_entitlement_shows_plan_and_allowance(client, as_user, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from backend.main import app

    _patch_account(monkeypatch)
    _patch_usage(monkeypatch, 1_000_000)
    now = datetime.now(UTC)

    async def _ent(conn, **kw):
        return Entitlement(
            plan_id="managed_basic",
            status="active",
            period_start=now - timedelta(days=2),
            period_end=now + timedelta(days=28),
        )

    monkeypatch.setattr(entitlement_repo, "get_entitlement", _ent)
    app.state.db = _FakePool()

    r = await client.get(MANAGED_STATUS)
    assert r.status_code == 200
    body = r.json()
    assert body["entitlement"]["plan_id"] == "managed_basic"
    assert body["entitlement"]["plan_display"] == plans.get_plan("managed_basic").display
    assert body["entitlement"]["status"] == "active"
    assert body["allowance_micros"] == plans.get_plan("managed_basic").allowance_micros
    assert body["usage"]["cost_micros"] == 1_000_000


@pytest.mark.asyncio
async def test_past_due_status_surfaces(client, as_user, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from backend.main import app

    _patch_account(monkeypatch)
    _patch_usage(monkeypatch, 500)
    now = datetime.now(UTC)

    async def _ent(conn, **kw):
        return Entitlement(
            plan_id="managed_basic",
            status="past_due",
            period_start=now - timedelta(days=1),
            period_end=now + timedelta(days=29),
        )

    monkeypatch.setattr(entitlement_repo, "get_entitlement", _ent)
    app.state.db = _FakePool()

    r = await client.get(MANAGED_STATUS)
    assert r.json()["entitlement"]["status"] == "past_due"
