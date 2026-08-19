"""Endpoint tests for POST /api/v1/derivatives/audio (P1-5 P4).

Mirrors `test_derivatives_animated_endpoint.py`'s harness: the no-DB `client`
fixture for the BYOK/schema/managed-ineligible/TTS-gate paths, and a real-
Postgres `TestClient(app)` lifespan for the trust-section access gate + the
managed-entitlement fork + metering (none of `require_project_access`,
`resolve_managed_access`, or `usage_repo.record_usage` is stubbed).
`generate_narration`'s LLM call and `synthesize_speech`'s TTS call are always
stubbed — real generation is Task 1's concern.
"""

from __future__ import annotations

import asyncio
import base64
import dataclasses
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest
from fastapi.testclient import TestClient
from wegofwd_llm.registry import PROVIDER_REGISTRY

from backend.config import settings
from backend.main import app
from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans
from backend.src.trust import topic_repo
from backend.tests.helpers import fake_provider

pytestmark = pytest.mark.asyncio

_GOOD_NARRATION = json.dumps(
    {"title": "Stormwater, decoded", "script": "Water finds the lowest point."}
)
_AUDIO_BYTES = b"ID3-fake-mp3-bytes"
_BYOK_OPENAI_KEY = "sk-" + "x" * 20


async def test_source_text_ok_and_key_never_leaks(client, known_test_openai_key, caplog):
    with (
        patch(
            "backend.src.derivatives.generate.build_provider",
            return_value=fake_provider(text=_GOOD_NARRATION),
        ),
        patch(
            "backend.src.derivatives.router.synthesize_speech",
            AsyncMock(return_value=(_AUDIO_BYTES, 30)),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "Stormwater.", "api_key": known_test_openai_key},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Stormwater, decoded"
    assert body["script"] == "Water finds the lowest point."
    assert body["mime"] == "audio/mpeg"
    assert body["audio_base64"] == base64.b64encode(_AUDIO_BYTES).decode()
    assert body["provenance"] == "ai-generated"
    assert known_test_openai_key not in json.dumps(body)
    assert known_test_openai_key not in caplog.text


async def test_default_model_uses_provider_registry_default_not_anthropic(
    client, known_test_openai_key
):
    # `_resolve_key_and_source` falls back to settings.anthropic_default_model
    # when body.model is omitted, regardless of provider_id — wrong for a
    # non-Anthropic provider. make_audio must re-resolve the registry's OWN
    # default model for "openai" (gpt-4o-mini) when the caller pins none.
    mock_narration = MagicMock(return_value=SimpleNamespace(title="T", script="S"))
    with (
        patch("backend.src.derivatives.router.generate_narration", mock_narration),
        patch(
            "backend.src.derivatives.router.synthesize_speech",
            AsyncMock(return_value=(_AUDIO_BYTES, 1)),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "s", "api_key": known_test_openai_key},
        )
    assert r.status_code == 200, r.text
    assert mock_narration.call_args.kwargs["model"] == PROVIDER_REGISTRY["openai"].default_model


async def test_both_source_and_topic_version_422(client, known_test_openai_key):
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={
            "source_text": "s",
            "topic_version_id": str(uuid.uuid4()),
            "api_key": known_test_openai_key,
        },
    )
    assert r.status_code == 422


async def test_neither_source_nor_topic_version_422(client, known_test_openai_key):
    r = await client.post("/api/v1/derivatives/audio", json={"api_key": known_test_openai_key})
    assert r.status_code == 422


async def test_malformed_topic_version_id_422(client, known_test_openai_key):
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={"topic_version_id": "not-a-uuid", "api_key": known_test_openai_key},
    )
    assert r.status_code == 422


async def test_dormant_config_disabled_422(client, known_test_openai_key, monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "")
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={"source_text": "s", "api_key": known_test_openai_key},
    )
    assert r.status_code == 422
    assert known_test_openai_key not in json.dumps(r.json())


async def test_non_tts_provider_422(client, known_test_api_key):
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={"source_text": "s", "api_key": known_test_api_key, "provider_id": "anthropic"},
    )
    assert r.status_code == 422
    assert known_test_api_key not in json.dumps(r.json())


async def test_managed_ineligible_400(client):
    r = await client.post("/api/v1/derivatives/audio", json={"source_text": "s"})
    assert r.status_code == 400
    assert "sk-" not in json.dumps(r.json())


async def test_narration_bad_output_502(client, known_test_openai_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "s", "api_key": known_test_openai_key},
        )
    assert r.status_code == 502
    assert known_test_openai_key not in json.dumps(r.json())


async def test_tts_failure_502(client, known_test_openai_key):
    from backend.src.derivatives.tts import TTSError

    with (
        patch(
            "backend.src.derivatives.generate.build_provider",
            return_value=fake_provider(text=_GOOD_NARRATION),
        ),
        patch(
            "backend.src.derivatives.router.synthesize_speech",
            AsyncMock(side_effect=TTSError("boom")),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "s", "api_key": known_test_openai_key},
        )
    assert r.status_code == 502
    assert known_test_openai_key not in json.dumps(r.json())


# ── HTTP: the trust-section seam + managed-entitlement fork + metering (real Postgres) ──
#
# Needs a real Postgres (local `mentible_test`; see conftest.py's DB-safety
# guard) because `require_project_access` / `resolve_managed_access` /
# `usage_repo.record_usage` read/write real rows — none is stubbed here.

DSN = os.environ.get("DATABASE_URL", "")
_managed_db = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")


@pytest.fixture(autouse=True)
def _isolate_managed_db_state():
    prior = getattr(app.state, "db", None)
    app.state.db = None
    yield
    app.state.db = prior
    app.dependency_overrides.pop(optional_user, None)
    app.dependency_overrides.pop(require_active_user, None)


_SEEDED_ACCOUNTS: list[uuid.UUID] = []


@pytest.fixture(autouse=True)
def _purge_seeded_managed_rows():
    yield
    if not DSN or not _SEEDED_ACCOUNTS:
        _SEEDED_ACCOUNTS.clear()
        return

    async def _run() -> None:
        conn = await asyncpg.connect(DSN)
        try:
            for account_id in _SEEDED_ACCOUNTS:
                await conn.execute("DELETE FROM usage_event WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM entitlement WHERE account_id = $1", account_id)
                await conn.execute(
                    "DELETE FROM project_membership WHERE account_id = $1", account_id
                )
                await conn.execute("DELETE FROM project WHERE owner_account_id = $1", account_id)
                await conn.execute("DELETE FROM account WHERE id = $1", account_id)
        finally:
            await conn.close()

    asyncio.run(_run())
    _SEEDED_ACCOUNTS.clear()


def _principal(sub: str, email: str | None = None) -> Principal:
    return Principal(sub=sub, email=email, issuer="test")


def _seed_account_and_entitlement(*, sub: str, email: str, plan_id: str) -> uuid.UUID:
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

    account_id = asyncio.run(_run())
    _SEEDED_ACCOUNTS.append(account_id)
    return account_id


def _record_usage(account_id: uuid.UUID, *, cost_micros: int) -> None:
    from backend.src.billing import usage_repo

    async def _run() -> None:
        conn = await asyncpg.connect(DSN)
        try:
            await usage_repo.record_usage(
                conn,
                account_id=account_id,
                provider="openai",
                model="tts:alloy",
                input_tokens=0,
                output_tokens=100,
                cost_micros=cost_micros,
                job_id=uuid.uuid4(),
            )
        finally:
            await conn.close()

    asyncio.run(_run())


def _seed_project_with_reviewer(*, owner_sub: str, owner_email: str, reviewer_email: str) -> str:
    with TestClient(app) as c:
        app.dependency_overrides[require_active_user] = lambda: _principal(owner_sub, owner_email)
        pid = c.post("/api/v1/trust/projects", json={"title": "Stormwater"}).json()["id"]
        inv = c.post(
            f"/api/v1/trust/projects/{pid}/invitations",
            json={"email": reviewer_email, "role": "reviewer"},
        )
        assert inv.status_code == 200, inv.text

        reviewer_sub = f"rv-sub-{uuid.uuid4()}"
        app.dependency_overrides[require_active_user] = lambda: _principal(
            reviewer_sub, reviewer_email
        )
        redeemed = c.post("/api/v1/trust/session/sync")
        assert redeemed.status_code == 200, redeemed.text
    app.dependency_overrides.pop(require_active_user, None)

    owner_acct_id = asyncio.run(_get_account_id(owner_sub))
    _SEEDED_ACCOUNTS.append(owner_acct_id)
    reviewer_acct_id = asyncio.run(_get_account_id(reviewer_sub))
    _SEEDED_ACCOUNTS.append(reviewer_acct_id)
    return pid


async def _get_account_id(sub: str) -> uuid.UUID:
    conn = await asyncpg.connect(DSN)
    try:
        acct = await accounts_repo.get_account(conn, idp_sub=sub)
        return acct.id
    finally:
        await conn.close()


def _seed_topic_version(*, project_id: str, created_by_sub: str, cited: list[str]) -> str:
    async def _run() -> str:
        conn = await asyncpg.connect(DSN)
        try:
            sections = [
                {"heading": "Runoff basics", "body": "Water follows slope.", "source_ids": cited}
            ]
            tv = await topic_repo.create_topic_version(
                conn,
                project_id=uuid.UUID(project_id),
                topic_id="t1",
                title="Runoff",
                source_ids=cited or None,
                content={"sections": sections},
                created_by_sub=created_by_sub,
            )
            return str(tv.id)
        finally:
            await conn.close()

    return asyncio.run(_run())


async def _lookup_sub_for_email(email: str) -> str:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow("SELECT idp_sub FROM account WHERE email = $1", email)
        return row["idp_sub"]
    finally:
        await conn.close()


@_managed_db
def test_topic_version_non_member_403():
    owner_sub = f"o-{uuid.uuid4()}"
    owner_email = f"{owner_sub}@x.z"
    reviewer_email = f"rv-{uuid.uuid4()}@x.z"
    pid = _seed_project_with_reviewer(
        owner_sub=owner_sub, owner_email=owner_email, reviewer_email=reviewer_email
    )
    version_id = _seed_topic_version(project_id=pid, created_by_sub=owner_sub, cited=[])

    stranger_sub = f"stranger-{uuid.uuid4()}"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(
            stranger_sub, f"{stranger_sub}@x.z"
        )
        try:
            r = c.post(
                "/api/v1/derivatives/audio",
                json={"topic_version_id": version_id, "api_key": _BYOK_OPENAI_KEY},
            )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 403
    assert _BYOK_OPENAI_KEY not in json.dumps(r.json())


@_managed_db
def test_topic_version_missing_404():
    owner_sub = f"o-{uuid.uuid4()}"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(owner_sub, f"{owner_sub}@x.z")
        try:
            r = c.post(
                "/api/v1/derivatives/audio",
                json={"topic_version_id": str(uuid.uuid4()), "api_key": _BYOK_OPENAI_KEY},
            )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 404


@_managed_db
def test_topic_version_signed_out_401():
    with TestClient(app) as c:
        r = c.post(
            "/api/v1/derivatives/audio",
            json={"topic_version_id": str(uuid.uuid4()), "api_key": _BYOK_OPENAI_KEY},
        )
    assert r.status_code == 401


@_managed_db
def test_managed_dormant_by_default_400_no_monkeypatch():
    # No monkeypatch of settings.managed_openai_api_key at all — proves the
    # spec's launch posture (managed audio dormant until ops configures a
    # managed TTS key) holds with ZERO extra gating code: the SAME
    # `_resolve_key_and_source` managed fork the other derivatives use
    # already 400s here because get_managed_key("openai") is None.
    sub = f"none-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 400
    assert "api_key is required" in r.json()["detail"]


@_managed_db
def test_managed_entitlement_grants_access_not_400(monkeypatch):
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"ent-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD_NARRATION),
                ),
                patch(
                    "backend.src.derivatives.router.synthesize_speech",
                    AsyncMock(return_value=(_AUDIO_BYTES, 30)),
                ),
            ):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code != 400


@_managed_db
def test_managed_over_cap_429(monkeypatch):
    # `plans.managed_basic` only lists "anthropic" in `managed_providers`
    # (openai capped-plan access isn't policy-live yet); AudioRequest
    # defaults `provider_id` to "openai", so exercising the over-cap fork
    # needs a capped plan that also grants openai. Widen ONLY this test's
    # view of the plan (not `plans.py` itself — a policy file this task
    # doesn't touch) via a scoped monkeypatch of the registry entry.
    basic = plans.get_plan("managed_basic")
    monkeypatch.setitem(
        plans._PLANS,
        "managed_basic",
        dataclasses.replace(
            basic, managed_providers=basic.managed_providers | frozenset({"openai"})
        ),
    )
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"cap-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_basic")
    allowance = plans.get_plan("managed_basic").allowance_micros
    _record_usage(account_id, cost_micros=allowance)
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            mock_narration = MagicMock()
            with patch("backend.src.derivatives.router.generate_narration", mock_narration):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 429
    mock_narration.assert_not_called()


@_managed_db
def test_managed_usage_metered_once_on_success(monkeypatch):
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"meter-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD_NARRATION),
                ),
                patch(
                    "backend.src.derivatives.router.synthesize_speech",
                    AsyncMock(return_value=(_AUDIO_BYTES, 42)),
                ),
            ):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 200, r.text

    async def _count() -> tuple[int, int]:
        conn = await asyncpg.connect(DSN)
        try:
            row = await conn.fetchrow(
                "SELECT count(*) AS n, coalesce(sum(output_tokens), 0) AS chars"
                " FROM usage_event WHERE account_id = $1 AND provider = 'openai'",
                account_id,
            )
            return row["n"], row["chars"]
        finally:
            await conn.close()

    count, chars = asyncio.run(_count())
    assert count == 1
    assert chars == 42


@_managed_db
def test_managed_usage_not_recorded_on_tts_failure(monkeypatch):
    from backend.src.derivatives.tts import TTSError

    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"meterfail-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD_NARRATION),
                ),
                patch(
                    "backend.src.derivatives.router.synthesize_speech",
                    AsyncMock(side_effect=TTSError("boom")),
                ),
            ):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 502

    async def _count() -> int:
        conn = await asyncpg.connect(DSN)
        try:
            return await conn.fetchval(
                "SELECT count(*) FROM usage_event WHERE account_id = $1", account_id
            )
        finally:
            await conn.close()

    assert asyncio.run(_count()) == 0
