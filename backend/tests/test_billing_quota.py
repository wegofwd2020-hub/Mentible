"""Free/Pro quota — T1 foundation (`access.is_pro`, `billing/quota.py`,
`GET /api/v1/billing/plan-status`). No enforcement here (that's T2); this only
computes/exposes status.

`is_pro` / `count_projects` / `count_generations` / `plan_status` run against a real
Postgres, rolled-back transaction per test (like test_billing_entitlement_repo.py) —
skipped without DATABASE_URL. `GET /plan-status` is tested offline (account/quota
patched, like test_billing_managed_status.py) so the endpoint shape is covered in CI
even without a database.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest
from fastapi import HTTPException

from backend.config import settings
from backend.src.accounts import repo as accounts_repo
from backend.src.billing import access, eligibility, entitlement_repo, quota
from backend.src.trust import project_repo

DSN = os.environ.get("DATABASE_URL", "")
db = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction()
    await tx.start()
    try:
        yield c
    finally:
        await tx.rollback()
        await c.close()


async def _account(conn, *, sub=None, email=None):
    sub = sub or f"quota-{uuid.uuid4()}"
    return await accounts_repo.get_or_create_account(conn, idp_sub=sub, email=email)


async def _grant_entitlement(conn, account_id, *, status="active", plan_id="managed_basic"):
    now = datetime.now(UTC)
    return await entitlement_repo.set_entitlement(
        conn,
        account_id=account_id,
        plan_id=plan_id,
        status=status,
        period_start=now - timedelta(days=1),
        period_end=now + timedelta(days=29),
    )


# ── is_pro ─────────────────────────────────────────────────────────────────────


@db
@pytest.mark.asyncio
async def test_is_pro_true_for_active_entitlement(conn):
    acct = await _account(conn)
    await _grant_entitlement(conn, acct.id)
    assert await access.is_pro(conn, account_id=acct.id) is True


@db
@pytest.mark.asyncio
async def test_is_pro_true_for_staff_allowlist(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset({"staff-sub-1"}))
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn, sub="staff-sub-1", email=None)
    assert await access.is_pro(conn, account_id=acct.id) is True


@db
@pytest.mark.asyncio
async def test_is_pro_false_when_neither(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    assert await access.is_pro(conn, account_id=acct.id) is False


@db
@pytest.mark.asyncio
async def test_is_pro_false_for_expired_entitlement(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    now = datetime.now(UTC)
    await entitlement_repo.set_entitlement(
        conn,
        account_id=acct.id,
        plan_id="managed_basic",
        status="active",
        period_start=now - timedelta(days=40),
        period_end=now - timedelta(days=10),
    )
    assert await access.is_pro(conn, account_id=acct.id) is False


# ── counts ───────────────────────────────────────────────────────────────────


@db
@pytest.mark.asyncio
async def test_count_projects(conn):
    a1 = await _account(conn)
    a2 = await _account(conn)
    await project_repo.create_project(conn, owner_account_id=a1.id, title="P1")
    await project_repo.create_project(conn, owner_account_id=a1.id, title="P2")
    await project_repo.create_project(conn, owner_account_id=a2.id, title="Other")
    assert await quota.count_projects(conn, a1.id) == 2
    assert await quota.count_projects(conn, a2.id) == 1


@db
@pytest.mark.asyncio
async def test_charge_generation_records_and_counts_per_account(conn):
    """Every generation route writes one `generation_event`; the count is per account."""
    acct = await _account(conn)
    other = await _account(conn)
    since = datetime.now(UTC) - timedelta(days=1)

    await quota.charge_generation(conn, account_id=acct.id, route="generate")
    await quota.charge_generation(conn, account_id=acct.id, route="derivative")
    await quota.charge_generation(conn, account_id=acct.id, route="trust")
    await quota.charge_generation(conn, account_id=other.id, route="generate")

    assert await quota.count_generations(conn, acct.id, since) == 3
    assert await quota.count_generations(conn, other.id, since) == 1


@db
@pytest.mark.asyncio
async def test_count_generations_excludes_outside_window(conn):
    acct = await _account(conn)
    await quota.charge_generation(conn, account_id=acct.id, route="generate")
    row_at = await conn.fetchval(
        "SELECT created_at FROM generation_event WHERE account_id = $1", acct.id
    )
    # A window starting after the event excludes it; one starting before includes it.
    assert await quota.count_generations(conn, acct.id, row_at + timedelta(days=1)) == 0
    assert await quota.count_generations(conn, acct.id, row_at - timedelta(days=1)) == 1


@db
@pytest.mark.asyncio
async def test_charge_generation_402_at_free_cap(conn, monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 2)
    acct = await _account(conn)
    await quota.charge_generation(conn, account_id=acct.id, route="generate")
    await quota.charge_generation(conn, account_id=acct.id, route="generate")
    with pytest.raises(HTTPException) as exc:
        await quota.charge_generation(conn, account_id=acct.id, route="generate")
    assert exc.value.status_code == 402
    # The refused attempt was not recorded.
    since = datetime.now(UTC) - timedelta(days=1)
    assert await quota.count_generations(conn, acct.id, since) == 2


@db
@pytest.mark.asyncio
async def test_charge_generation_pro_never_refused_but_recorded(conn, monkeypatch):
    monkeypatch.setattr(settings, "free_max_generations", 1)
    acct = await _account(conn)
    await _grant_entitlement(conn, acct.id)
    for _ in range(3):
        await quota.charge_generation(conn, account_id=acct.id, route="generate")
    since = datetime.now(UTC) - timedelta(days=1)
    assert await quota.count_generations(conn, acct.id, since) == 3


# ── plan_status ──────────────────────────────────────────────────────────────


@db
@pytest.mark.asyncio
async def test_plan_status_free_under_cap(conn, monkeypatch):
    monkeypatch.setattr(settings, "free_max_projects", 2)
    monkeypatch.setattr(settings, "free_max_generations", 20)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    await project_repo.create_project(conn, owner_account_id=acct.id, title="P1")

    ps = await quota.plan_status(conn, account_id=acct.id)
    assert ps.is_pro is False
    assert ps.projects == 1
    assert ps.at_project_cap is False
    assert ps.at_generation_cap is False


@db
@pytest.mark.asyncio
async def test_plan_status_free_at_cap(conn, monkeypatch):
    monkeypatch.setattr(settings, "free_max_projects", 1)
    monkeypatch.setattr(settings, "free_max_generations", 1)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    await project_repo.create_project(conn, owner_account_id=acct.id, title="P1")
    await quota.charge_generation(conn, account_id=acct.id, route="generate")

    ps = await quota.plan_status(conn, account_id=acct.id)
    assert ps.is_pro is False
    assert ps.at_project_cap is True
    assert ps.at_generation_cap is True


@db
@pytest.mark.asyncio
async def test_plan_status_pro_never_at_cap(conn, monkeypatch):
    monkeypatch.setattr(settings, "free_max_projects", 1)
    monkeypatch.setattr(settings, "free_max_generations", 1)
    acct = await _account(conn)
    await _grant_entitlement(conn, acct.id)
    await project_repo.create_project(conn, owner_account_id=acct.id, title="P1")
    await project_repo.create_project(conn, owner_account_id=acct.id, title="P2")
    await quota.charge_generation(conn, account_id=acct.id, route="generate")

    ps = await quota.plan_status(conn, account_id=acct.id)
    assert ps.is_pro is True
    assert ps.projects == 2
    assert ps.at_project_cap is False
    assert ps.at_generation_cap is False


# ── GET /plan-status (offline: account + quota patched) ────────────────────────


PLAN_STATUS = "/api/v1/billing/plan-status"


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
    from backend.main import app
    from backend.src.accounts.deps import require_active_user
    from backend.src.auth.principal import Principal

    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub="u1", email="u1@x.com", issuer="https://test"
    )
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_active_user, None)


def _patch_account(monkeypatch):
    class _Acct:
        id = uuid.uuid4()
        idp_sub = "u1"

    async def _get_or_create(conn, **kw):
        return _Acct()

    monkeypatch.setattr(accounts_repo, "get_or_create_account", _get_or_create)


def _patch_plan_status(monkeypatch, ps: quota.PlanStatus):
    async def _plan_status(conn, **kw):
        return ps

    monkeypatch.setattr(quota, "plan_status", _plan_status)


@pytest.mark.asyncio
async def test_plan_status_endpoint_shape_free(client, as_user, monkeypatch):
    from backend.main import app

    _patch_account(monkeypatch)
    _patch_plan_status(
        monkeypatch,
        quota.PlanStatus(
            is_pro=False,
            max_projects=2,
            max_generations=20,
            gen_window_days=30,
            projects=2,
            generations=5,
            at_project_cap=True,
            at_generation_cap=False,
            features=(),
        ),
    )
    app.state.db = _FakePool()

    r = await client.get(PLAN_STATUS)
    assert r.status_code == 200
    body = r.json()
    assert body["is_pro"] is False
    assert body["caps"] == {"max_projects": 2, "max_generations": 20, "gen_window_days": 30}
    assert body["usage"] == {"projects": 2, "generations": 5}
    assert body["at_project_cap"] is True
    assert body["at_generation_cap"] is False
    assert body["features"] == []


@pytest.mark.asyncio
async def test_plan_status_endpoint_shape_pro(client, as_user, monkeypatch):
    from backend.main import app

    _patch_account(monkeypatch)
    _patch_plan_status(
        monkeypatch,
        quota.PlanStatus(
            is_pro=True,
            max_projects=2,
            max_generations=20,
            gen_window_days=30,
            projects=50,
            generations=500,
            at_project_cap=False,
            at_generation_cap=False,
            features=("export_docx", "export_epub"),
        ),
    )
    app.state.db = _FakePool()

    r = await client.get(PLAN_STATUS)
    assert r.status_code == 200
    body = r.json()
    assert body["is_pro"] is True
    assert body["usage"] == {"projects": 50, "generations": 500}
    assert body["at_project_cap"] is False
    assert body["at_generation_cap"] is False
    assert body["features"] == ["export_docx", "export_epub"]


@pytest.mark.asyncio
async def test_plan_status_requires_auth(client):
    from backend.main import app

    app.state.db = _FakePool()
    r = await client.get(PLAN_STATUS)
    assert r.status_code in (401, 403)
