"""Endpoint tests for POST /api/v1/derivatives/card (P1-5 Task 3).

Mirrors `test_derivatives_post.py`'s harness: the no-DB `client` fixture for
the BYOK/schema/managed-ineligible paths, and a real-Postgres `TestClient(app)`
lifespan for the trust-section access gate + the managed-entitlement fork
(neither `require_project_access` nor `resolve_managed_access` is stubbed).
`compile_card_png` is always stubbed — rendering itself is Task 1's concern.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import asyncpg
import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import eligibility, entitlement_repo, plans, usage_repo
from backend.src.trust import topic_repo
from backend.tests.helpers import fake_provider

_GOOD = json.dumps(
    {"headline": "Stormwater, decoded", "subtext": "A short field guide.", "source_label": None}
)

pytestmark = pytest.mark.asyncio


async def test_source_text_ok_and_key_never_leaks(client, known_test_api_key, caplog):
    with (
        patch(
            "backend.src.derivatives.generate.build_provider",
            return_value=fake_provider(text=_GOOD),
        ),
        patch(
            "backend.src.derivatives.router.compile_card_png",
            return_value=b"PNGBYTES",
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/card",
            json={"source_text": "Stormwater.", "api_key": known_test_api_key},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["card"]["headline"] == "Stormwater, decoded"
    assert body["size"] == "square"
    assert body["provenance"] == "ai-generated"
    assert body["image_png_base64"] == base64.b64encode(b"PNGBYTES").decode()
    # AC: the key never rides the response or any log line.
    assert known_test_api_key not in json.dumps(body)
    assert known_test_api_key not in caplog.text


async def test_both_source_and_topic_version_422(client, known_test_api_key):
    # A well-formed (but nonexistent) UUID, so this fails on the "exactly one
    # source" model_validator specifically — not incidentally on UUID parsing.
    r = await client.post(
        "/api/v1/derivatives/card",
        json={
            "source_text": "s",
            "topic_version_id": str(uuid.uuid4()),
            "api_key": known_test_api_key,
        },
    )
    assert r.status_code == 422


async def test_neither_source_nor_topic_version_422(client, known_test_api_key):
    r = await client.post(
        "/api/v1/derivatives/card",
        json={"api_key": known_test_api_key},
    )
    assert r.status_code == 422


async def test_malformed_topic_version_id_422(client, known_test_api_key):
    # `topic_version_id` is typed `uuid.UUID | None` (Fix round 1) — a
    # malformed value must be rejected by pydantic with a clean 422 before the
    # handler ever runs a query against the uuid column, never an uncaught
    # asyncpg DataError surfacing as a framework 500.
    r = await client.post(
        "/api/v1/derivatives/card",
        json={"topic_version_id": "not-a-uuid", "api_key": known_test_api_key},
    )
    assert r.status_code == 422


async def test_managed_ineligible_400(client):
    r = await client.post("/api/v1/derivatives/card", json={"source_text": "s"})
    assert r.status_code == 400
    assert "sk-" not in json.dumps(r.json())


async def test_bad_output_502(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        r = await client.post(
            "/api/v1/derivatives/card",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 502
    assert known_test_api_key not in json.dumps(r.json())


async def test_render_failure_502(client, known_test_api_key):
    from backend.src.derivatives.render import CardRenderError

    with (
        patch(
            "backend.src.derivatives.generate.build_provider",
            return_value=fake_provider(text=_GOOD),
        ),
        patch(
            "backend.src.derivatives.router.compile_card_png",
            side_effect=CardRenderError("boom"),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/card",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 502
    assert known_test_api_key not in json.dumps(r.json())


# ── HTTP: the trust-section seam + managed-entitlement fork (real Postgres) ──
#
# These need a real Postgres (local `mentible_test`; see conftest.py's DB-safety
# guard) because `require_project_access` / `resolve_managed_access` read real
# `project` / `project_membership` / `account` / `entitlement` rows — neither is
# stubbed here. They start the app's real lifespan so `app.state.db` is wired.

DSN = os.environ.get("DATABASE_URL", "")
_managed_db = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")


@pytest.fixture(autouse=True)
def _isolate_managed_db_state():
    """Reset `app.state.db` and dependency overrides around every test in this
    file so a real pool / override opened by one test never leaks into a
    `client`-fixture test expecting the no-DB / anonymous path (mirrors
    test_derivatives_post.py's `_isolate_managed_db_state`)."""
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


def _seed_project_with_reviewer(*, owner_sub: str, owner_email: str, reviewer_email: str) -> str:
    """Owner account + a project it owns + a redeemed reviewer membership.

    Uses the app's real HTTP surface (trust router) so membership is created
    exactly the way production does (invite -> session/sync redeem), rather
    than poking `project_membership` directly. Returns the project id."""
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


@_managed_db
def test_topic_version_reviewer_200_with_provenance_label(monkeypatch):
    owner_sub = f"o-{uuid.uuid4()}"
    owner_email = f"{owner_sub}@x.z"
    reviewer_email = f"rv-{uuid.uuid4()}@x.z"
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset({reviewer_email.lower()}))
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())

    pid = _seed_project_with_reviewer(
        owner_sub=owner_sub, owner_email=owner_email, reviewer_email=reviewer_email
    )
    version_id = _seed_topic_version(
        project_id=pid, created_by_sub=owner_sub, cited=["src-1", "src-2"]
    )

    reviewer_sub_row = asyncio.run(_lookup_sub_for_email(reviewer_email))
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(
            reviewer_sub_row, reviewer_email
        )
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD),
                ),
                patch(
                    "backend.src.derivatives.router.compile_card_png",
                    return_value=b"PNGBYTES",
                ),
            ):
                r = c.post(
                    "/api/v1/derivatives/card",
                    json={"topic_version_id": version_id},
                )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["card"]["source_label"] == "Based on 2 cited source(s)"


async def _lookup_sub_for_email(email: str) -> str:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow("SELECT idp_sub FROM account WHERE email = $1", email)
        return row["idp_sub"]
    finally:
        await conn.close()


_BYOK_KEY = "sk-ant-" + "x" * 20


@_managed_db
def test_topic_version_non_member_403():
    # BYOK key sidesteps the managed key-fork entirely, so this exercises the
    # trust-section access gate in isolation regardless of managed eligibility.
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
                "/api/v1/derivatives/card",
                json={"topic_version_id": version_id, "api_key": _BYOK_KEY},
            )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 403
    assert _BYOK_KEY not in json.dumps(r.json())


@_managed_db
def test_topic_version_missing_404():
    owner_sub = f"o-{uuid.uuid4()}"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(owner_sub, f"{owner_sub}@x.z")
        try:
            r = c.post(
                "/api/v1/derivatives/card",
                json={"topic_version_id": str(uuid.uuid4()), "api_key": _BYOK_KEY},
            )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 404


@_managed_db
def test_topic_version_signed_out_401():
    # No `optional_user` override → anonymous. A BYOK key bypasses the managed
    # fork, so the 401 below is specifically the topic_version_id sign-in gate.
    with TestClient(app) as c:
        r = c.post(
            "/api/v1/derivatives/card",
            json={"topic_version_id": str(uuid.uuid4()), "api_key": _BYOK_KEY},
        )
    assert r.status_code == 401


@_managed_db
def test_managed_entitlement_grants_access_not_400(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    sub = f"ent-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD),
                ),
                patch(
                    "backend.src.derivatives.router.compile_card_png",
                    return_value=b"PNGBYTES",
                ),
            ):
                r = c.post("/api/v1/derivatives/card", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code != 400


@_managed_db
def test_managed_neither_entitlement_nor_staff_400(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    monkeypatch.setattr(eligibility, "_MANAGED_EMAILS", frozenset())
    monkeypatch.setattr(eligibility, "_MANAGED_SUBS", frozenset())
    sub = f"none-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            r = c.post("/api/v1/derivatives/card", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 400
    assert "api_key is required" in r.json()["detail"]


@_managed_db
def test_managed_over_cap_429(monkeypatch):
    monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-" + "x" * 20)
    sub = f"cap-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_basic")
    allowance = plans.get_plan("managed_basic").allowance_micros
    _record_usage(account_id, cost_micros=allowance)
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            mock_generate_card = MagicMock()
            with patch("backend.src.derivatives.router.generate_card", mock_generate_card):
                r = c.post("/api/v1/derivatives/card", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 429
    mock_generate_card.assert_not_called()
