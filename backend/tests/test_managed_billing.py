"""Managed billing — Phase 1 (ADR-005 D6 / docs/MANAGED_BILLING_BUILD_PLAN.md).

Covers the vault *mechanism* (`billing.vault`), the eligibility *policy*
(`billing.eligibility`), and the `/generate` managed fork: an eligible caller may
omit the BYOK key and generate on OUR vault key, an ineligible/anonymous caller may
not, and a supplied key always stays BYOK (never silently promoted — ADR-014 D3).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from backend.config import settings
from backend.src.auth.principal import Principal
from backend.src.billing import eligibility, vault
from backend.src.billing.access import ManagedAccess
from backend.tests.helpers import fake_provider
from backend.tests.test_generate_e2e import _FAKE_LESSON_JSON, _wait_for_status

# A fake but sk-ant--shaped managed key, so the redaction pattern also catches it.
# Deliberately short (suffix < 30 chars) so the "no real sk-ant- key" CI gate, which
# flags sk-ant- + 30+ chars, doesn't trip on this fixture.
_MANAGED_KEY = "sk-ant-MANAGED_FAKE_key_xxxxx"


def _principal(sub: str = "staff-1", email: str | None = None) -> Principal:
    return Principal(sub=sub, email=email, issuer="iss")


@pytest.fixture(autouse=True)
def _isolate_db_state():
    """Isolate every test here from a leaked `app.state.db` pool.

    The DB-enabled CI job runs other tests that leave a (possibly closed) real pool on
    `app.state.db`; the managed branch reads it. Default it to None (the unmetered, no-DB
    managed path most of these tests intend); the cap tests set their own fake pool in the
    body. Restored on teardown."""
    from backend.main import app

    prior = getattr(app.state, "db", None)
    app.state.db = None
    yield
    app.state.db = prior


# ── Unit: vault (the wegofwd-billing mechanism) ────────────────────────────────


def test_get_managed_key_returns_configured(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _MANAGED_KEY)
    assert vault.get_managed_key("anthropic") == _MANAGED_KEY
    # Phase 1 is Anthropic-only — other providers aren't offered managed yet.
    assert vault.get_managed_key("openai") is None
    assert vault.managed_provider_ids() == frozenset({"anthropic"})


def test_managed_off_when_unset(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", None)
    monkeypatch.setattr(settings, "managed_openai_api_key", None)
    monkeypatch.setattr(settings, "managed_groq_api_key", None)
    monkeypatch.setattr(settings, "managed_gemini_api_key", None)
    assert vault.get_managed_key("anthropic") is None
    assert vault.managed_provider_ids() == frozenset()


def test_managed_multi_provider_keys(monkeypatch):
    # Phase 6: the vault serves any ToS-cleared provider whose key is set.
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _MANAGED_KEY)
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-managed-openai-fake")
    monkeypatch.setattr(settings, "managed_groq_api_key", None)
    monkeypatch.setattr(settings, "managed_gemini_api_key", None)
    assert vault.get_managed_key("openai") == "sk-managed-openai-fake"
    assert vault.get_managed_key("groq") is None
    assert vault.managed_provider_ids() == frozenset({"anthropic", "openai"})


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
    """Override optional_user so the request resolves to an authed, eligible principal.
    (`app.state.db` isolation is handled by the autouse `_isolate_db_state`.)"""
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


# ── Phase 2: the pre-flight cap gate ───────────────────────────────────────────


class _FakePool:
    """Minimal asyncpg.Pool stand-in: acquire() → async context manager → dummy conn."""

    def acquire(self):
        class _CM:
            async def __aenter__(self):
                return object()

            async def __aexit__(self, *exc):
                return False

        return _CM()


def _fake_grant(allowance: int = 1) -> ManagedAccess:
    return ManagedAccess(
        allowance_micros=allowance, since=datetime.now(UTC), source="managed_basic"
    )


@pytest.mark.asyncio
async def test_managed_cap_exceeded_returns_429(
    client, fake_redis, managed_enabled, as_eligible_user, monkeypatch
):
    """With the account store present, an eligible managed request whose plan allowance is
    already met is refused 429 BEFORE a job is created (pre-flight)."""
    from backend.main import app
    from backend.src.accounts import repo as accounts_repo
    from backend.src.billing import access as access_mod

    class _Acct:
        id = uuid.uuid4()

    async def _get_or_create(conn, **kw):
        return _Acct()

    async def _resolve(conn, **kw):
        return _fake_grant()

    async def _over(conn, **kw):
        return True

    monkeypatch.setattr(accounts_repo, "get_or_create_account", _get_or_create)
    monkeypatch.setattr(access_mod, "resolve_managed_access", _resolve)
    monkeypatch.setattr(access_mod, "over_cap", _over)
    app.state.db = _FakePool()
    try:
        submit = await client.post("/api/v1/generate", json=_managed_body())
    finally:
        app.state.db = None

    assert submit.status_code == 429


@pytest.mark.asyncio
async def test_managed_ineligible_no_grant_returns_400(
    client, fake_redis, managed_enabled, as_eligible_user, monkeypatch
):
    """With the account store present, no resolved grant (no plan, not staff) ⇒ 400."""
    from backend.main import app
    from backend.src.accounts import repo as accounts_repo
    from backend.src.billing import access as access_mod

    class _Acct:
        id = uuid.uuid4()

    async def _get_or_create(conn, **kw):
        return _Acct()

    async def _no_grant(conn, **kw):
        return None

    monkeypatch.setattr(accounts_repo, "get_or_create_account", _get_or_create)
    monkeypatch.setattr(access_mod, "resolve_managed_access", _no_grant)
    app.state.db = _FakePool()
    try:
        submit = await client.post("/api/v1/generate", json=_managed_body())
    finally:
        app.state.db = None

    assert submit.status_code == 400


@pytest.mark.asyncio
async def test_managed_under_cap_proceeds(
    client, fake_redis, managed_enabled, as_eligible_user, monkeypatch
):
    """With a valid grant and under the allowance, the managed request proceeds."""
    from backend.main import app
    from backend.src.accounts import repo as accounts_repo
    from backend.src.billing import access as access_mod

    class _Acct:
        id = uuid.uuid4()

    async def _get_or_create(conn, **kw):
        return _Acct()

    async def _resolve(conn, **kw):
        return _fake_grant()

    async def _under(conn, **kw):
        return False

    monkeypatch.setattr(accounts_repo, "get_or_create_account", _get_or_create)
    monkeypatch.setattr(access_mod, "resolve_managed_access", _resolve)
    monkeypatch.setattr(access_mod, "over_cap", _under)
    app.state.db = _FakePool()
    try:
        with patch(
            "backend.src.generate.tasks.build_provider",
            return_value=fake_provider(text=_FAKE_LESSON_JSON),
        ):
            submit = await client.post("/api/v1/generate", json=_managed_body())
            assert submit.status_code == 202
            body = await _wait_for_status(client, submit.json()["job_id"], "done")
    finally:
        app.state.db = None

    assert body["status"] == "done"
    assert body["trust"]["policy"]["byok"] is False
