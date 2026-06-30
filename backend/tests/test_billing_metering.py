"""Managed metering — Phase 2 mechanism (ADR-005 D6): pricing, the cap policy, and the
worker's best-effort usage-recording helper. All offline (no DB) — the DB-backed
`usage_repo` is covered in test_billing_usage_repo.py (skipped without DATABASE_URL).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from backend.config import settings
from backend.src.billing import access, pricing, usage_repo
from backend.src.billing.access import ManagedAccess


# ── Fake asyncpg pool (acquire() → async context manager → a dummy conn) ────────
class _FakePool:
    def __init__(self):
        self.acquired = 0

    def acquire(self):
        pool = self

        class _CM:
            async def __aenter__(self):
                pool.acquired += 1
                return object()  # a dummy conn; record_usage is patched in tests

            async def __aexit__(self, *exc):
                return False

        return _CM()


# ── pricing (pure mechanism) ────────────────────────────────────────────────────


def test_cost_micros_sonnet():
    # 100 input × $3/1M + 500 output × $15/1M = 300 + 7500 micro-USD.
    assert pricing.cost_micros("anthropic", "claude-sonnet-4-6", 100, 500) == 7800


def test_cost_micros_zero_tokens():
    assert pricing.cost_micros("anthropic", "claude-sonnet-4-6", 0, 0) == 0


def test_cost_micros_unknown_model_uses_default():
    # An unpriced model falls back to the conservative default rate (3, 15), never 0.
    assert pricing.cost_micros("anthropic", "some-new-model", 100, 500) == 7800
    assert pricing.cost_micros("whoever", "whatever", 1_000_000, 0) == 3_000_000


def test_cost_micros_multi_provider(monkeypatch):
    # Phase 6 added OpenAI/Groq/Gemini rates (1M input tokens × rate-per-1M = rate micros).
    assert pricing.cost_micros("openai", "gpt-4o-mini", 1_000_000, 0) == 150_000  # $0.15/1M
    assert pricing.cost_micros("gemini", "gemini-2.5-pro", 1_000_000, 0) == 1_250_000


# ── access.over_cap — the Phase-6 spend ceiling (O7) ───────────────────────────


@pytest.mark.asyncio
async def test_spend_ceiling_blocks_even_unlimited_plan(monkeypatch):
    """The hard ceiling backstops OUR spend even on an unlimited (allowance 0) grant."""
    monkeypatch.setattr(settings, "managed_account_spend_ceiling_micros", 10_000)

    async def _usage(*a, **k):
        return usage_repo.PeriodUsage(1, 1, 10_000, 1)

    monkeypatch.setattr(usage_repo, "period_usage", _usage)
    assert await access.over_cap(None, account_id=uuid.uuid4(), access=_grant(0)) is True


@pytest.mark.asyncio
async def test_spend_ceiling_below_allows(monkeypatch):
    monkeypatch.setattr(settings, "managed_account_spend_ceiling_micros", 10_000)

    async def _usage(*a, **k):
        return usage_repo.PeriodUsage(1, 1, 9_999, 1)

    monkeypatch.setattr(usage_repo, "period_usage", _usage)
    assert await access.over_cap(None, account_id=uuid.uuid4(), access=_grant(0)) is False


@pytest.mark.asyncio
async def test_ceiling_binds_before_a_larger_allowance(monkeypatch):
    monkeypatch.setattr(settings, "managed_account_spend_ceiling_micros", 10_000)

    async def _usage(*a, **k):
        return usage_repo.PeriodUsage(1, 1, 10_000, 1)

    monkeypatch.setattr(usage_repo, "period_usage", _usage)
    # Allowance is huge, but the ceiling (10_000) trips first.
    assert await access.over_cap(None, account_id=uuid.uuid4(), access=_grant(1_000_000)) is True


# ── access.over_cap (cost cap against a resolved grant) ─────────────────────────


def _grant(allowance: int) -> ManagedAccess:
    return ManagedAccess(allowance_micros=allowance, since=datetime.now(UTC), source="test")


@pytest.mark.asyncio
async def test_over_cap_unlimited_never_reads(monkeypatch):
    """allowance 0 ⇒ never over cap (unlimited) — and usage is not even read."""

    async def _boom(*a, **k):
        raise AssertionError("period_usage should not be read for an unlimited grant")

    monkeypatch.setattr(usage_repo, "period_usage", _boom)
    assert await access.over_cap(None, account_id=uuid.uuid4(), access=_grant(0)) is False


@pytest.mark.asyncio
async def test_over_cap_below_threshold(monkeypatch):
    async def _usage(*a, **k):
        return usage_repo.PeriodUsage(input_tokens=1, output_tokens=1, cost_micros=9_999, events=1)

    monkeypatch.setattr(usage_repo, "period_usage", _usage)
    assert await access.over_cap(None, account_id=uuid.uuid4(), access=_grant(10_000)) is False


@pytest.mark.asyncio
async def test_over_cap_at_or_above_threshold(monkeypatch):
    async def _usage(*a, **k):
        return usage_repo.PeriodUsage(input_tokens=1, output_tokens=1, cost_micros=10_000, events=5)

    monkeypatch.setattr(usage_repo, "period_usage", _usage)
    assert await access.over_cap(None, account_id=uuid.uuid4(), access=_grant(10_000)) is True


# ── worker recording helper (best-effort wiring) ────────────────────────────────


@pytest.mark.asyncio
async def test_record_managed_usage_prices_and_writes(monkeypatch):
    from backend.src.generate import tasks

    captured: dict = {}

    async def _fake_record(conn, **kw):
        captured.update(kw)

    monkeypatch.setattr(tasks.usage_repo, "record_usage", _fake_record)

    pool = _FakePool()
    account_id = uuid.uuid4()
    job_id = uuid.uuid4()
    usage = {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "input_tokens": 100,
        "output_tokens": 500,
        "tokens_estimated": False,
        "attempts": 1,
    }
    await tasks._record_managed_usage(pool, account_id, job_id, usage)

    assert pool.acquired == 1
    assert captured["account_id"] == account_id
    assert captured["job_id"] == job_id
    assert captured["provider"] == "anthropic"
    assert captured["cost_micros"] == 7800  # priced from the observed tokens


@pytest.mark.asyncio
async def test_record_managed_usage_noops_without_pool_or_account(monkeypatch):
    from backend.src.generate import tasks

    async def _boom(*a, **k):
        raise AssertionError("record_usage must not be called when metering is unavailable")

    monkeypatch.setattr(tasks.usage_repo, "record_usage", _boom)

    usage = {"provider": "anthropic", "model": "m", "input_tokens": 1, "output_tokens": 1}
    # No pool, no account, no usage — each is a silent no-op (BYOK / demo / no-DB path).
    await tasks._record_managed_usage(None, uuid.uuid4(), uuid.uuid4(), usage)
    await tasks._record_managed_usage(_FakePool(), None, uuid.uuid4(), usage)
    await tasks._record_managed_usage(_FakePool(), uuid.uuid4(), uuid.uuid4(), None)


@pytest.mark.asyncio
async def test_record_managed_usage_swallows_errors(monkeypatch):
    """A metering failure must never propagate (the generation already succeeded)."""
    from backend.src.generate import tasks

    async def _explode(conn, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(tasks.usage_repo, "record_usage", _explode)
    usage = {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "input_tokens": 1,
        "output_tokens": 1,
    }
    # Must not raise.
    await tasks._record_managed_usage(_FakePool(), uuid.uuid4(), uuid.uuid4(), usage)
