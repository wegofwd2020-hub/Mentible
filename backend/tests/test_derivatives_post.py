"""Endpoint tests for POST /api/v1/derivatives/post (ADR-037 D8, Task 3).

Inline synchronous generation (no job queue, no /jobs poll) — mirrors the
BYOK-vs-managed key selection of /generate but returns the result in the same
request. Patches `backend.src.derivatives.generate.build_provider` (where the
provider factory is actually called from) with a fake provider — no live
Anthropic, no live DB.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import asyncpg
import pytest
from fastapi.testclient import TestClient
from wegofwd_llm.errors import LLMAuthError, LLMRateLimitError

from backend.config import settings
from backend.main import app
from backend.src.accounts import repo as accounts_repo
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import eligibility, entitlement_repo, plans, usage_repo
from backend.src.derivatives.schemas import DerivativeResponse, PostVariant
from backend.tests.helpers import fake_provider

_GOOD = json.dumps(
    {
        "variants": [
            {"hook": f"h{i}", "body": f"b{i}", "hashtags": ["#x"], "cta": None} for i in range(3)
        ]
    }
)

# Two variants — a valid PostVariant shape but the WRONG count (contract is 3).
_WRONG_COUNT = json.dumps(
    {
        "variants": [
            {"hook": f"h{i}", "body": f"b{i}", "hashtags": ["#x"], "cta": None} for i in range(2)
        ]
    }
)

pytestmark = pytest.mark.asyncio


async def test_byok_post_ok_and_key_never_leaks(client, known_test_api_key, caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={
                "source_text": "Stormwater.",
                "platform": "linkedin",
                "api_key": known_test_api_key,
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert len(body["variants"]) == 3
    assert body["provenance"] == "ai-generated"
    assert body["platform"] == "linkedin"
    # AC: the key never rides the response or any log line.
    assert known_test_api_key not in json.dumps(body)
    assert known_test_api_key not in caplog.text


async def test_managed_ineligible_400(client):
    # no api_key + anonymous caller (no auth override) → not managed-eligible →
    # generic 400, no key material in the body.
    r = await client.post("/api/v1/derivatives/post", json={"source_text": "s"})
    assert r.status_code == 400
    # No leaked secret material — the body is a generic message.
    assert "sk-" not in json.dumps(r.json())


async def test_platform_x_reaches_generation(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "platform": "x", "api_key": known_test_api_key},
        )
    assert r.status_code == 200
    assert r.json()["platform"] == "x"


async def test_bad_output_502(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 502
    # Never echoes the key on a failure response either.
    assert known_test_api_key not in json.dumps(r.json())


async def test_empty_source_422(client, known_test_api_key):
    r = await client.post(
        "/api/v1/derivatives/post",
        json={"source_text": "", "api_key": known_test_api_key},
    )
    assert r.status_code == 422
    # The 422 handler scrubs the echoed body — the key must not reappear.
    assert known_test_api_key not in json.dumps(r.json())


async def test_wrong_variant_count_502(client, known_test_api_key):
    # A valid-shaped payload with the wrong COUNT (2, not 3) must fail the
    # _DerivativeOutput length constraint on every repair attempt → 502, never
    # a silently-shipped off-contract response.
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_WRONG_COUNT),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 502
    assert known_test_api_key not in json.dumps(r.json())


async def test_provider_auth_rejected_502_no_key_leak(client, known_test_api_key, caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(side_effect=LLMAuthError("provider said no")),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 502
    # Actionable, key-free — on the response and in the logs.
    assert known_test_api_key not in json.dumps(r.json())
    assert known_test_api_key not in caplog.text


async def test_provider_rate_limited_429(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(side_effect=LLMRateLimitError("slow down")),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 429
    assert known_test_api_key not in json.dumps(r.json())


async def test_image_forwarded_to_generate_post(client, known_test_api_key):
    # Proves the router→generate_post CONTRACT directly: patch generate_post
    # itself (not the vision plumbing) and assert it was called with the
    # ReferenceImage built from the request body. A test that instead patches
    # `anthropic.Anthropic` can't distinguish "image forwarded" from "image
    # silently dropped" — build_provider's text path and the vision path share
    # that same module attribute, so both would return the fake response
    # regardless of whether `image=` ever reached generate_post.
    fake_response = DerivativeResponse(
        platform="linkedin",
        variants=[
            PostVariant(hook=f"h{i}", body=f"b{i}", hashtags=["#x"], cta=None) for i in range(3)
        ],
        provenance="ai-generated",
    )
    mock_generate_post = MagicMock(return_value=fake_response)
    with patch("backend.src.derivatives.router.generate_post", mock_generate_post):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={
                "source_text": "s",
                "api_key": known_test_api_key,
                "image": {"media_type": "image/png", "data": "aGk="},
            },
        )
    assert r.status_code == 200
    assert len(r.json()["variants"]) == 3
    assert known_test_api_key not in json.dumps(r.json())
    # Base64 image data must not leak into the response.
    assert "aGk=" not in json.dumps(r.json())

    mock_generate_post.assert_called_once()
    _, kwargs = mock_generate_post.call_args
    forwarded_image = kwargs["image"]
    assert forwarded_image is not None
    assert forwarded_image.media_type == "image/png"
    assert forwarded_image.data == "aGk="


async def test_image_non_anthropic_provider_400(client):
    # The guard must fire BEFORE any key selection / LLM work — patch
    # generate_post and assert it was never called.
    mock_generate_post = MagicMock()
    with patch("backend.src.derivatives.router.generate_post", mock_generate_post):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={
                "source_text": "s",
                "provider_id": "openai",
                "api_key": "sk-" + "y" * 40,
                "image": {"media_type": "image/png", "data": "aGk="},
            },
        )
    assert r.status_code == 400
    mock_generate_post.assert_not_called()
    body = r.json()
    assert "anthropic" in body["detail"].lower()
    assert "sk-" + "y" * 40 not in json.dumps(body)


# ── HTTP: the managed-entitlement fork (mirrors /generate — ADR-005 D6 Phase 3) ──
#
# These run against a REAL Postgres (local `mentible_test`, e.g. port 5439 — NEVER
# the repo `.env`'s prod pooler; see `tests/conftest.py`'s DB-safety guard) because
# `resolve_managed_access` reads real `account` / `entitlement` / `usage_event`
# rows — `resolve_managed_access` itself is never stubbed here. They start the
# app's real lifespan (`with TestClient(app) as c:`), which wires a genuine
# `app.state.db` pool — unlike this file's other tests, which run the async
# `client` fixture with no DB and so only ever exercise the no-DB (staff-allowlist,
# unmetered) fallback fork.

DSN = os.environ.get("DATABASE_URL", "")
_managed_db = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")


@pytest.fixture(autouse=True)
def _isolate_managed_db_state():
    """Reset `app.state.db` around every test in this file so a real pool opened
    by one of the managed-entitlement tests below never leaks into a `client`
    fixture test that expects the no-DB path (mirrors test_managed_billing.py's
    `_isolate_db_state`)."""
    prior = getattr(app.state, "db", None)
    app.state.db = None
    yield
    app.state.db = prior


def _principal(sub: str, email: str | None = None) -> Principal:
    return Principal(sub=sub, email=email, issuer="test")


def _seed_account_and_entitlement(*, sub: str, email: str, plan_id: str) -> uuid.UUID:
    """Create the account + an active entitlement on their own committed
    connection (not the app pool) so the rows are visible to the request the
    TestClient makes. Returns the account id."""

    async def _run() -> uuid.UUID:
        conn = await asyncpg.connect(DSN)
        try:
            acct = await accounts_repo.get_or_create_account(conn, idp_sub=sub, email=email)
            now = datetime.now(UTC)
            await entitlement_repo.set_entitlement(
                conn,
                account_id=acct.id,
                plan_id=plan_id,
                status="active",
                period_start=now - timedelta(days=1),
                period_end=now + timedelta(days=29),
            )
            return acct.id
        finally:
            await conn.close()

    return asyncio.run(_run())


def _record_usage(account_id: uuid.UUID, *, cost_micros: int) -> None:
    async def _run() -> None:
        conn = await asyncpg.connect(DSN)
        try:
            await usage_repo.record_usage(
                conn,
                account_id=account_id,
                provider="anthropic",
                model="claude-sonnet-4-6",
                input_tokens=100,
                output_tokens=100,
                cost_micros=cost_micros,
                job_id=uuid.uuid4(),
            )
        finally:
            await conn.close()

    asyncio.run(_run())


@_managed_db
def test_managed_entitlement_grants_access_not_400(monkeypatch):
    """A real `managed_unlimited` entitlement — not the staff allowlist — lets a
    no-`api_key` request through the DB-backed grant path (mirrors /generate's
    `resolve_managed_access` fork). `resolve_managed_access` is not stubbed:
    this exercises the real account + entitlement rows end to end."""
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    sub = f"ent-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with patch(
                "backend.src.derivatives.generate.build_provider",
                return_value=fake_provider(text=_GOOD),
            ):
                r = c.post("/api/v1/derivatives/post", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code != 400


@_managed_db
def test_managed_staff_allowlist_still_grants_access_not_400(monkeypatch):
    """The Phase-1 staff allowlist still works through the DB-backed fork (no
    entitlement row needed) — mirrors /generate's `source="staff"` grant."""
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    sub = f"staff-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset({email.lower()}))
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with patch(
                "backend.src.derivatives.generate.build_provider",
                return_value=fake_provider(text=_GOOD),
            ):
                r = c.post("/api/v1/derivatives/post", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code != 400


@_managed_db
def test_managed_neither_entitlement_nor_staff_400(monkeypatch):
    """No entitlement row and not staff-allowlisted → the generic 400 via the
    real DB path (`resolve_managed_access` resolves to None)."""
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    sub = f"none-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            r = c.post("/api/v1/derivatives/post", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 400
    assert "api_key is required" in r.json()["detail"]


@_managed_db
def test_managed_over_cap_429(monkeypatch):
    """An entitled account whose usage already meets its plan allowance is
    refused 429 before any generation runs (mirrors /generate's `over_cap`
    pre-flight gate) — no stub on `resolve_managed_access` or `over_cap`."""
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    sub = f"cap-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_basic")
    allowance = plans.get_plan("managed_basic").allowance_micros
    _record_usage(account_id, cost_micros=allowance)
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            mock_generate_post = MagicMock()
            with patch("backend.src.derivatives.router.generate_post", mock_generate_post):
                r = c.post("/api/v1/derivatives/post", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 429
    mock_generate_post.assert_not_called()
