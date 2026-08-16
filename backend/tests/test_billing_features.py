"""Per-feature entitlement axis (T-P0-3): `Plan.features`, `access.has_feature` /
`access.account_features`. No behavior change to any gate here — that's Task 4
(switching the export gate from `is_pro` to `has_feature`). This only builds and
tests the machinery.

`has_feature` / `account_features` run against a real Postgres, rolled-back
transaction per test — mirrors `test_billing_quota.py`'s `is_pro` tests exactly
(same fixtures, same DB skip discipline).
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from backend.src.accounts import repo as accounts_repo
from backend.src.billing import access, eligibility, entitlement_repo, plans
from backend.src.billing.plans import EXPORT_FEATURES

DSN = os.environ.get("DATABASE_URL", "")
db = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")


# ── plans.py — pure, no DB ──────────────────────────────────────────────────


def test_all_named_plans_grant_every_export_feature():
    # Backward-compat invariant: switching the export gate from is_pro to
    # has_feature must not strip EPUB/PDF from any entitled user.
    for pid in plans.plan_ids():
        plan = plans.get_plan(pid)
        assert EXPORT_FEATURES <= plan.features, f"{pid} missing export features"


# ── access.has_feature / access.account_features — DB-gated ────────────────


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
    sub = sub or f"feat-{uuid.uuid4()}"
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


@db
@pytest.mark.asyncio
async def test_has_feature_true_for_plan_that_grants_it(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    await _grant_entitlement(conn, acct.id, plan_id="managed_basic")
    assert await access.has_feature(conn, account_id=acct.id, feature="export_docx") is True


@db
@pytest.mark.asyncio
async def test_has_feature_false_for_feature_plan_lacks(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    await _grant_entitlement(conn, acct.id, plan_id="managed_basic")
    assert await access.has_feature(conn, account_id=acct.id, feature="not_a_real_feature") is False


@db
@pytest.mark.asyncio
async def test_has_feature_false_when_no_entitlement_and_not_staff(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    assert await access.has_feature(conn, account_id=acct.id, feature="export_docx") is False


@db
@pytest.mark.asyncio
async def test_has_feature_true_for_staff_allowlist_every_export_feature(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset({"staff-feat-1"}))
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn, sub="staff-feat-1", email=None)
    for feature in EXPORT_FEATURES:
        assert await access.has_feature(conn, account_id=acct.id, feature=feature) is True


@db
@pytest.mark.asyncio
async def test_has_feature_false_for_expired_entitlement(conn, monkeypatch):
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
    assert await access.has_feature(conn, account_id=acct.id, feature="export_docx") is False


@db
@pytest.mark.asyncio
async def test_account_features_returns_plan_features(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    await _grant_entitlement(conn, acct.id, plan_id="managed_basic")
    feats = await access.account_features(conn, account_id=acct.id)
    assert feats == EXPORT_FEATURES


@db
@pytest.mark.asyncio
async def test_account_features_empty_when_neither(conn, monkeypatch):
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    acct = await _account(conn)
    assert await access.account_features(conn, account_id=acct.id) == frozenset()
