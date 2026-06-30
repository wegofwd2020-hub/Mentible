"""RevenueCat billing — Phase 4 (ADR-005 D6): event→entitlement mapping + the webhook.

Offline. The mapping is pure; the webhook's DB write is exercised with a fake pool and
patched repos (the real entitlement repo is covered in test_billing_entitlement_repo.py).
"""

from __future__ import annotations

import uuid

import pytest

from backend.config import settings
from backend.src.billing import revenuecat

WEBHOOK = "/api/v1/billing/revenuecat/webhook"
SECRET = "rc-webhook-secret-xyz"
# A fixed future expiry (epoch ms) so tests don't depend on the clock.
_EXP_MS = 1_900_000_000_000


def _payload(
    etype: str, product: str | None = None, app_user_id: str = "sub-1", exp_ms=None
) -> dict:
    event: dict = {"type": etype, "app_user_id": app_user_id}
    if product is not None:
        event["product_id"] = product
    if exp_ms is not None:
        event["expiration_at_ms"] = exp_ms
    return {"event": event, "api_version": "1.0"}


# ── Fake asyncpg pool with a transaction()-capable conn ─────────────────────────
class _FakeConn:
    def transaction(self):
        class _T:
            async def __aenter__(self):
                return None

            async def __aexit__(self, *exc):
                return False

        return _T()


class _FakePool:
    def acquire(self):
        conn = _FakeConn()

        class _CM:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return _CM()


@pytest.fixture(autouse=True)
def _isolate_db_state():
    """Isolate from a leaked app.state.db pool (DB-enabled CI job); apply tests set their own."""
    from backend.main import app

    prior = getattr(app.state, "db", None)
    app.state.db = None
    yield
    app.state.db = prior


# ── Pure: parse_product_plan_map ────────────────────────────────────────────────


def test_parse_product_plan_map():
    m = revenuecat.parse_product_plan_map("p_a:managed_basic, p_b:managed_unlimited ,bad,")
    assert m == {"p_a": "managed_basic", "p_b": "managed_unlimited"}
    assert revenuecat.parse_product_plan_map("") == {}


# ── Pure: map_event ─────────────────────────────────────────────────────────────

_MAP = {"prod_basic": "managed_basic"}


def test_map_grant_mapped_product():
    intent = revenuecat.map_event(_payload("INITIAL_PURCHASE", "prod_basic", exp_ms=_EXP_MS), _MAP)
    assert intent is not None
    assert intent.action == "grant"
    assert intent.status == "active"
    assert intent.plan_id == "managed_basic"
    assert intent.app_user_id == "sub-1"
    assert intent.period_end is not None and intent.period_end.year >= 2030


def test_map_renewal_is_grant():
    assert revenuecat.map_event(_payload("RENEWAL", "prod_basic"), _MAP).action == "grant"


def test_map_grant_unmapped_product_is_ignored():
    assert revenuecat.map_event(_payload("INITIAL_PURCHASE", "unknown_prod"), _MAP) is None


def test_map_expiration_sets_canceled():
    intent = revenuecat.map_event(_payload("EXPIRATION"), _MAP)
    assert intent.action == "set_status" and intent.status == "canceled"


def test_map_billing_issue_past_due():
    intent = revenuecat.map_event(_payload("BILLING_ISSUE"), _MAP)
    assert intent.action == "set_status" and intent.status == "past_due"


def test_map_cancellation_ignored():
    # Auto-renew off; access continues until EXPIRATION — no immediate change.
    assert revenuecat.map_event(_payload("CANCELLATION", "prod_basic"), _MAP) is None


def test_map_missing_fields_ignored():
    assert revenuecat.map_event({"event": {"type": "INITIAL_PURCHASE"}}, _MAP) is None  # no user
    assert revenuecat.map_event({"event": {"app_user_id": "x"}}, _MAP) is None  # no type
    assert revenuecat.map_event({}, _MAP) is None


# ── Webhook endpoint ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_webhook_rejects_missing_auth(client, monkeypatch):
    monkeypatch.setattr(settings, "revenuecat_webhook_auth", SECRET)
    r = await client.post(WEBHOOK, json=_payload("INITIAL_PURCHASE", "prod_basic"))
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_disabled_when_secret_unset(client, monkeypatch):
    monkeypatch.setattr(settings, "revenuecat_webhook_auth", "")
    r = await client.post(
        WEBHOOK, json=_payload("INITIAL_PURCHASE", "prod_basic"), headers={"Authorization": "x"}
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_ignores_unmapped_event(client, monkeypatch):
    monkeypatch.setattr(settings, "revenuecat_webhook_auth", SECRET)
    r = await client.post(WEBHOOK, json=_payload("CANCELLATION"), headers={"Authorization": SECRET})
    assert r.status_code == 200
    assert r.json()["status"] == "ignored"


@pytest.mark.asyncio
async def test_webhook_grant_applies_entitlement(client, monkeypatch):
    from backend.main import app
    from backend.src.accounts import repo as accounts_repo
    from backend.src.billing import entitlement_repo
    from backend.src.billing import router as billing_router

    monkeypatch.setattr(settings, "revenuecat_webhook_auth", SECRET)
    monkeypatch.setattr(billing_router, "_PRODUCT_PLAN_MAP", {"prod_basic": "managed_basic"})

    class _Acct:
        id = uuid.uuid4()

    async def _get_account(conn, **kw):
        return _Acct()

    captured: dict = {}

    async def _set_entitlement(conn, **kw):
        captured.update(kw)

    monkeypatch.setattr(accounts_repo, "get_account", _get_account)
    monkeypatch.setattr(entitlement_repo, "set_entitlement", _set_entitlement)
    app.state.db = _FakePool()
    r = await client.post(
        WEBHOOK,
        json=_payload("INITIAL_PURCHASE", "prod_basic", exp_ms=_EXP_MS),
        headers={"Authorization": SECRET},
    )

    assert r.status_code == 200
    assert r.json()["status"] == "applied"
    assert captured["plan_id"] == "managed_basic"
    assert captured["status"] == "active"


@pytest.mark.asyncio
async def test_webhook_expiration_sets_status(client, monkeypatch):
    from backend.main import app
    from backend.src.accounts import repo as accounts_repo
    from backend.src.billing import entitlement_repo

    monkeypatch.setattr(settings, "revenuecat_webhook_auth", SECRET)

    class _Acct:
        id = uuid.uuid4()

    async def _get_account(conn, **kw):
        return _Acct()

    captured: dict = {}

    async def _set_status(conn, **kw):
        captured.update(kw)

    monkeypatch.setattr(accounts_repo, "get_account", _get_account)
    monkeypatch.setattr(entitlement_repo, "set_status", _set_status)
    app.state.db = _FakePool()
    r = await client.post(WEBHOOK, json=_payload("EXPIRATION"), headers={"Authorization": SECRET})

    assert r.status_code == 200
    assert captured["status"] == "canceled"


@pytest.mark.asyncio
async def test_webhook_unknown_user_is_noop(client, monkeypatch):
    from backend.main import app
    from backend.src.accounts import repo as accounts_repo

    monkeypatch.setattr(settings, "revenuecat_webhook_auth", SECRET)

    async def _no_account(conn, **kw):
        return None

    monkeypatch.setattr(accounts_repo, "get_account", _no_account)
    app.state.db = _FakePool()
    r = await client.post(
        WEBHOOK,
        json=_payload("EXPIRATION", app_user_id="ghost"),
        headers={"Authorization": SECRET},
    )

    assert r.status_code == 200
    assert r.json()["status"] == "no_account"
