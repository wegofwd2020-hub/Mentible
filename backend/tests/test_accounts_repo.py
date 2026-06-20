"""Account + credential-set repo (ADR-014 D2/D8) against a real Postgres.

Each test runs in a transaction that is rolled back, so they share one migrated
DB without bleeding into each other. Skipped when DATABASE_URL is unset (local
runs without a DB, and the non-DB CI jobs)."""

from __future__ import annotations

import os

import asyncpg
import pytest

from backend.src.accounts import repo

DSN = os.environ.get("DATABASE_URL", "")

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)"),
]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tr = c.transaction()
    await tr.start()
    try:
        yield c
    finally:
        await tr.rollback()
        await c.close()


async def test_get_or_create_is_idempotent(conn):
    a1 = await repo.get_or_create_account(conn, idp_sub="sub-1", email="a@x.com")
    a2 = await repo.get_or_create_account(conn, idp_sub="sub-1", email="a@x.com")
    assert a1.id == a2.id
    assert a1.idp_sub == "sub-1"
    assert a1.email == "a@x.com"


async def test_later_null_email_does_not_clobber(conn):
    await repo.get_or_create_account(conn, idp_sub="sub-2", email="keep@x.com")
    a = await repo.get_or_create_account(conn, idp_sub="sub-2", email=None)
    assert a.email == "keep@x.com"


async def test_get_account_missing_is_none(conn):
    assert await repo.get_account(conn, idp_sub="nope") is None


async def test_credentials_upsert_and_list(conn):
    acct = await repo.get_or_create_account(conn, idp_sub="sub-3", email=None)
    await repo.upsert_credential(
        conn, account_id=acct.id, provider_id="anthropic", source="device_local", status="valid"
    )
    await repo.upsert_credential(conn, account_id=acct.id, provider_id="groq", source="synced_e2e")
    creds = await repo.list_credentials(conn, account_id=acct.id)
    assert [c.provider_id for c in creds] == ["anthropic", "groq"]  # ordered
    assert creds[0].status == "valid"
    assert creds[1].status == "unverified"  # default


async def test_credential_upsert_updates_in_place(conn):
    acct = await repo.get_or_create_account(conn, idp_sub="sub-4", email=None)
    await repo.upsert_credential(
        conn, account_id=acct.id, provider_id="anthropic", source="device_local"
    )
    updated = await repo.upsert_credential(
        conn, account_id=acct.id, provider_id="anthropic", source="managed_vault", status="valid"
    )
    assert updated.source == "managed_vault"
    assert updated.status == "valid"
    assert len(await repo.list_credentials(conn, account_id=acct.id)) == 1


@pytest.mark.parametrize("bad", [("source", "bogus"), ("status", "maybe")])
async def test_invalid_enum_rejected(conn, bad):
    acct = await repo.get_or_create_account(conn, idp_sub="sub-5", email=None)
    field, value = bad
    kwargs = {"source": "device_local", "status": "unverified"}
    kwargs[field] = value
    with pytest.raises(ValueError):
        await repo.upsert_credential(conn, account_id=acct.id, provider_id="x", **kwargs)


async def test_delete_account_cascades_credentials(conn):
    acct = await repo.get_or_create_account(conn, idp_sub="sub-6", email=None)
    await repo.upsert_credential(
        conn, account_id=acct.id, provider_id="anthropic", source="device_local"
    )
    assert await repo.delete_account(conn, idp_sub="sub-6") is True
    assert await repo.get_account(conn, idp_sub="sub-6") is None
    assert await repo.list_credentials(conn, account_id=acct.id) == []  # cascaded


async def test_delete_account_missing_returns_false(conn):
    assert await repo.delete_account(conn, idp_sub="ghost") is False


async def test_delete_credential(conn):
    acct = await repo.get_or_create_account(conn, idp_sub="sub-7", email=None)
    await repo.upsert_credential(
        conn, account_id=acct.id, provider_id="anthropic", source="device_local"
    )
    assert await repo.delete_credential(conn, account_id=acct.id, provider_id="anthropic") is True
    assert await repo.delete_credential(conn, account_id=acct.id, provider_id="anthropic") is False


# ── suspend + admin listing (ADR-020) ────────────────────────────────────────


async def test_new_account_not_suspended(conn):
    a = await repo.get_or_create_account(conn, idp_sub="sub-s1", email=None)
    assert a.suspended is False
    assert a.suspended_at is None


async def test_set_account_suspended_round_trip(conn):
    await repo.get_or_create_account(conn, idp_sub="sub-s2", email=None)
    a = await repo.set_account_suspended(conn, idp_sub="sub-s2", suspended=True)
    assert a is not None and a.suspended is True and a.suspended_at is not None
    # get_account reflects it
    assert (await repo.get_account(conn, idp_sub="sub-s2")).suspended is True
    # reactivate clears the timestamp
    a = await repo.set_account_suspended(conn, idp_sub="sub-s2", suspended=False)
    assert a is not None and a.suspended is False and a.suspended_at is None


async def test_set_account_suspended_missing_returns_none(conn):
    assert await repo.set_account_suspended(conn, idp_sub="ghost", suspended=True) is None


async def test_list_and_count_accounts(conn):
    for i in range(3):
        await repo.get_or_create_account(conn, idp_sub=f"sub-list-{i}", email=None)
    total = await repo.count_accounts(conn)
    assert total >= 3
    page = await repo.list_accounts(conn, limit=2, offset=0)
    assert len(page) == 2
    # newest first
    page2 = await repo.list_accounts(conn, limit=100, offset=0)
    created = [a.created_at for a in page2]
    assert created == sorted(created, reverse=True)
