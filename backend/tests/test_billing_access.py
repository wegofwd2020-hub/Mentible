"""Managed access policy — Phase 3 (ADR-005 D6): plans + resolve_managed_access.

Offline: `resolve_managed_access`'s DB read (`entitlement_repo.get_entitlement`) and the
staff override (`is_managed_eligible`) are patched, so the plan-vs-staff-vs-none decision
is tested without a database. The entitlement repo itself is in test_billing_entitlement_repo.py.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from backend.src.billing import access, plans
from backend.src.billing.entitlement_repo import Entitlement

# ── plans (pure) ────────────────────────────────────────────────────────────────


def test_get_plan_known_and_unknown():
    p = plans.get_plan("managed_basic")
    assert p is not None and "anthropic" in p.managed_providers
    assert plans.get_plan("does-not-exist") is None


def test_plan_ids_includes_starter_set():
    ids = plans.plan_ids()
    assert "managed_basic" in ids and "managed_unlimited" in ids


# ── resolve_managed_access ──────────────────────────────────────────────────────


def _ent(plan_id="managed_basic", status="active", start=None, end=None) -> Entitlement:
    now = datetime.now(UTC)
    return Entitlement(
        plan_id=plan_id,
        status=status,
        period_start=start or now - timedelta(days=1),
        period_end=end or now + timedelta(days=29),
    )


def _patch_entitlement(monkeypatch, ent):
    async def _get(conn, **kw):
        return ent

    monkeypatch.setattr(access.entitlement_repo, "get_entitlement", _get)


@pytest.fixture
def no_staff(monkeypatch):
    """Staff override off, so resolution depends purely on the entitlement."""
    monkeypatch.setattr(access, "is_managed_eligible", lambda principal, provider_id: False)


async def _resolve(provider_id="anthropic"):
    return await access.resolve_managed_access(
        None, account_id=uuid.uuid4(), provider_id=provider_id, principal=None
    )


@pytest.mark.asyncio
async def test_active_plan_grants_access(monkeypatch, no_staff):
    _patch_entitlement(monkeypatch, _ent())
    grant = await _resolve("anthropic")
    assert grant is not None
    assert grant.source == "managed_basic"
    assert grant.allowance_micros == plans.get_plan("managed_basic").allowance_micros


@pytest.mark.asyncio
async def test_plan_not_covering_provider_is_no_grant(monkeypatch, no_staff):
    _patch_entitlement(monkeypatch, _ent())  # covers anthropic only
    assert await _resolve("openai") is None


@pytest.mark.asyncio
async def test_expired_entitlement_is_no_grant(monkeypatch, no_staff):
    now = datetime.now(UTC)
    _patch_entitlement(
        monkeypatch, _ent(start=now - timedelta(days=40), end=now - timedelta(days=10))
    )
    assert await _resolve("anthropic") is None


@pytest.mark.asyncio
async def test_canceled_entitlement_is_no_grant(monkeypatch, no_staff):
    _patch_entitlement(monkeypatch, _ent(status="canceled"))
    assert await _resolve("anthropic") is None


@pytest.mark.asyncio
async def test_staff_override_when_no_plan(monkeypatch):
    _patch_entitlement(monkeypatch, None)
    monkeypatch.setattr(access, "is_managed_eligible", lambda principal, provider_id: True)
    grant = await _resolve("anthropic")
    assert grant is not None and grant.source == "staff"


@pytest.mark.asyncio
async def test_no_plan_no_staff_is_no_grant(monkeypatch):
    _patch_entitlement(monkeypatch, None)
    monkeypatch.setattr(access, "is_managed_eligible", lambda principal, provider_id: False)
    assert await _resolve("anthropic") is None
