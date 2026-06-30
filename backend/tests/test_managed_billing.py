"""Managed billing — Phase 1 (ADR-005 D6 / docs/MANAGED_BILLING_BUILD_PLAN.md).

Covers the vault *mechanism* (`billing.vault`), the eligibility *policy*
(`billing.eligibility`), and the `/generate` managed fork: an eligible caller may
omit the BYOK key and generate on OUR vault key, an ineligible/anonymous caller may
not, and a supplied key always stays BYOK (never silently promoted — ADR-014 D3).
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest

from backend.config import settings
from backend.src.auth.principal import Principal
from backend.src.billing import eligibility, vault
from backend.tests.helpers import fake_provider
from backend.tests.test_generate_e2e import _FAKE_LESSON_JSON, _wait_for_status

# A fake but sk-ant--shaped managed key, so the redaction pattern also catches it.
# Deliberately short (suffix < 30 chars) so the "no real sk-ant- key" CI gate, which
# flags sk-ant- + 30+ chars, doesn't trip on this fixture.
_MANAGED_KEY = "sk-ant-MANAGED_FAKE_key_xxxxx"


def _principal(sub: str = "staff-1", email: str | None = None) -> Principal:
    return Principal(sub=sub, email=email, issuer="iss")


# ── Unit: vault (the wegofwd-billing mechanism) ────────────────────────────────


def test_get_managed_key_returns_configured(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _MANAGED_KEY)
    assert vault.get_managed_key("anthropic") == _MANAGED_KEY
    # Phase 1 is Anthropic-only — other providers aren't offered managed yet.
    assert vault.get_managed_key("openai") is None
    assert vault.managed_provider_ids() == frozenset({"anthropic"})


def test_managed_off_when_unset(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", None)
    assert vault.get_managed_key("anthropic") is None
    assert vault.managed_provider_ids() == frozenset()


# ── Unit: eligibility (per-app policy) ─────────────────────────────────────────


@pytest.fixture
def managed_enabled(monkeypatch):
    """An internal managed allowlist with one eligible sub + email and a vault key."""
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _MANAGED_KEY)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset({"staff-1"}))
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset({"staff@example.com"}))


def test_anonymous_not_eligible(managed_enabled):
    assert eligibility.is_managed_eligible(None, "anthropic") is False


def test_not_on_allowlist_not_eligible(managed_enabled):
    assert eligibility.is_managed_eligible(_principal(sub="rando"), "anthropic") is False


def test_on_allowlist_by_sub_eligible(managed_enabled):
    assert eligibility.is_managed_eligible(_principal(sub="staff-1"), "anthropic") is True


def test_on_allowlist_by_email_case_insensitive(managed_enabled):
    # Email matched case-insensitively (sub not listed — email is the hit).
    assert (
        eligibility.is_managed_eligible(
            _principal(sub="other", email="STAFF@example.com"), "anthropic"
        )
        is True
    )


def test_eligible_user_but_provider_not_managed(managed_enabled):
    # On the allowlist, but openai isn't offered managed in Phase 1 (no key).
    assert eligibility.is_managed_eligible(_principal(sub="staff-1"), "openai") is False


def test_empty_allowlist_nobody_eligible(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _MANAGED_KEY)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    assert eligibility.is_managed_eligible(_principal(sub="staff-1"), "anthropic") is False


# ── HTTP: the /generate managed fork ───────────────────────────────────────────


def _managed_body(**overrides) -> dict:
    """A /generate body with NO api_key (the managed path)."""
    body = {
        "request_id": str(uuid.uuid4()),
        "topic": "Quadratic formula",
        "level": "student",
        "language": "en",
        "format": "lesson",
        "depth": "standard",
    }
    body.update(overrides)
    return body


@pytest.fixture
def as_eligible_user():
    """Override optional_user so the request resolves to an authed, eligible principal."""
    from backend.main import app
    from backend.src.auth.deps import optional_user

    app.dependency_overrides[optional_user] = lambda: _principal(sub="staff-1")
    try:
        yield
    finally:
        app.dependency_overrides.pop(optional_user, None)


@pytest.mark.asyncio
async def test_managed_keyless_request_uses_vault_key(
    client, fake_redis, managed_enabled, as_eligible_user
):
    """An eligible caller omits the api_key and generates on OUR vault key; the trust
    manifest marks it managed (byok=False) and the key never rides the status row."""
    captured: dict[str, str] = {}

    def _build(provider_id, *, api_key, model=None):
        captured["api_key"] = api_key
        captured["provider_id"] = provider_id
        return fake_provider(text=_FAKE_LESSON_JSON)

    with patch("backend.src.generate.tasks.build_provider", side_effect=_build):
        submit = await client.post("/api/v1/generate", json=_managed_body())
        assert submit.status_code == 202
        body = await _wait_for_status(client, submit.json()["job_id"], "done")

    assert body["status"] == "done"
    # The worker used OUR vault key, not a user-supplied one.
    assert captured["api_key"] == _MANAGED_KEY
    assert captured["provider_id"] == "anthropic"
    # Provenance/policy: managed ⇒ byok False; we never store a key.
    assert body["trust"]["policy"]["byok"] is False
    assert body["trust"]["policy"]["key_stored"] is False
    # The managed key never appears in the serialised status row.
    assert _MANAGED_KEY not in json.dumps(body)


@pytest.mark.asyncio
async def test_managed_job_stores_no_byok_envelope(
    client, fake_redis, managed_enabled, as_eligible_user
):
    """A managed job stores NO byok:{job_id} envelope — the key comes from the vault."""
    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_FAKE_LESSON_JSON),
    ):
        submit = await client.post("/api/v1/generate", json=_managed_body())
        job_id = submit.json()["job_id"]
        await _wait_for_status(client, job_id, "done")

    assert await fake_redis.get(f"byok:{job_id}") is None


@pytest.mark.asyncio
async def test_keyless_anonymous_rejected_400(client, fake_redis, managed_enabled):
    """No key + anonymous caller ⇒ 400 (generic; doesn't reveal allowlist membership)."""
    # No as_eligible_user override → optional_user is anonymous (None) in tests.
    submit = await client.post("/api/v1/generate", json=_managed_body())
    assert submit.status_code == 400


@pytest.mark.asyncio
async def test_keyless_ineligible_user_rejected_400(client, fake_redis, monkeypatch):
    """No key + authed-but-not-allowlisted caller ⇒ 400 (no job runs)."""
    from backend.main import app
    from backend.src.auth.deps import optional_user

    monkeypatch.setattr(settings, "managed_anthropic_api_key", _MANAGED_KEY)
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset({"staff-1"}))
    app.dependency_overrides[optional_user] = lambda: _principal(sub="not-staff")
    try:
        submit = await client.post("/api/v1/generate", json=_managed_body())
    finally:
        app.dependency_overrides.pop(optional_user, None)
    assert submit.status_code == 400


@pytest.mark.asyncio
async def test_byok_key_not_promoted_to_managed(
    client, fake_redis, managed_enabled, as_eligible_user, known_test_api_key
):
    """An eligible caller who DOES send a key still goes BYOK (byok=True) — a BYOK key
    is never silently promoted to managed (ADR-014 D3)."""
    captured: dict[str, str] = {}

    def _build(provider_id, *, api_key, model=None):
        captured["api_key"] = api_key
        return fake_provider(text=_FAKE_LESSON_JSON)

    with patch("backend.src.generate.tasks.build_provider", side_effect=_build):
        submit = await client.post(
            "/api/v1/generate", json=_managed_body(api_key=known_test_api_key)
        )
        body = await _wait_for_status(client, submit.json()["job_id"], "done")

    # The user's key was used, not the vault key; policy reflects BYOK.
    assert captured["api_key"] == known_test_api_key
    assert body["trust"]["policy"]["byok"] is True
