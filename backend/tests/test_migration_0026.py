"""Migration `0026` — splits the @noble GCM tag out of `synced_epub.ciphertext`
into its own `tag` column (Increment 2.1: native file cipher returns the tag
separately, so the wire body becomes ciphertext-only).

Drives the REAL alembic migration (not a hand-rolled facsimile) against the
test database via `alembic.command`, seeding an Inc-2-shaped row (whose
`ciphertext` is `actual_ciphertext || tag(16)`, per Inc-2's @noble output)
directly at the SQL level, then asserting the backfill split.

Skipped without DATABASE_URL, like every other DB-backed test module here.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import asyncpg
import pytest
from alembic.config import Config

from alembic import command

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return cfg


def _current_revision() -> str | None:
    async def _fetch() -> str | None:
        conn = await asyncpg.connect(DSN)
        try:
            row = await conn.fetchrow("SELECT version_num FROM alembic_version")
            return row["version_num"] if row else None
        finally:
            await conn.close()

    return asyncio.run(_fetch())


async def _seed(
    *,
    owner_account_id: uuid.UUID,
    epub_id: str,
    ciphertext: bytes,
    byte_size: int,
    deleted: bool,
    meta_ciphertext: bytes = b"META",
    meta_nonce: bytes = b"N",
) -> None:
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute(
            """
            INSERT INTO synced_epub
                (owner_account_id, epub_id, ciphertext, nonce, meta_ciphertext,
                 meta_nonce, wrapped_dk, dk_nonce, client_version, byte_size, deleted)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """,
            owner_account_id,
            epub_id,
            ciphertext,
            b"nonce-bytes",
            meta_ciphertext,
            meta_nonce,
            b"wrapped-dk-bytes",
            b"dk-nonce-bytes",
            "v-mig-0026-test",
            byte_size,
            deleted,
        )
    finally:
        await conn.close()


async def _make_account() -> uuid.UUID:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow(
            "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id",
            f"mig-0026-{uuid.uuid4()}",
        )
        return row["id"]
    finally:
        await conn.close()


async def _fetch_row(*, owner_account_id: uuid.UUID, epub_id: str) -> asyncpg.Record:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow(
            "SELECT tag, ciphertext, byte_size, meta_ciphertext, deleted "
            "FROM synced_epub WHERE owner_account_id = $1 AND epub_id = $2",
            owner_account_id,
            epub_id,
        )
        assert row is not None
        return row
    finally:
        await conn.close()


async def _has_tag_column() -> bool:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'synced_epub' AND column_name = 'tag'"
        )
        return row is not None
    finally:
        await conn.close()


def test_0026_splits_tag_and_preserves_meta():
    cfg = _alembic_config()

    # Re-runnable: if the DB is already at (or past) 0026 from a prior run of
    # this suite, roll back to 0025 first so this test always exercises the
    # forward migration against a genuinely pre-2.1-shaped table.
    if asyncio.run(_has_tag_column()):
        command.downgrade(cfg, "0025")
    assert _current_revision() == "0025"
    assert not asyncio.run(_has_tag_column())

    owner_id = asyncio.run(_make_account())

    # A live row: 24 bytes of "ciphertext" + a 16-byte @noble-appended GCM tag.
    ct_plus_tag = bytes(range(24)) + bytes([0xAA]) * 16
    asyncio.run(
        _seed(
            owner_account_id=owner_id,
            epub_id="live-1",
            ciphertext=ct_plus_tag,
            byte_size=len(ct_plus_tag),
            deleted=False,
            meta_ciphertext=b"META",
        )
    )
    # A tombstone: byte_size=0, ciphertext='' — must land with tag=''.
    asyncio.run(
        _seed(
            owner_account_id=owner_id,
            epub_id="dead-1",
            ciphertext=b"",
            byte_size=0,
            deleted=True,
        )
    )

    command.upgrade(cfg, "0026")

    assert _current_revision() == "0026"
    assert asyncio.run(_has_tag_column())

    live = asyncio.run(_fetch_row(owner_account_id=owner_id, epub_id="live-1"))
    assert live["tag"] == bytes([0xAA]) * 16
    assert live["ciphertext"] == bytes(range(24))
    assert live["byte_size"] == 24
    assert live["meta_ciphertext"] == b"META"  # untouched by the backfill

    dead = asyncio.run(_fetch_row(owner_account_id=owner_id, epub_id="dead-1"))
    assert dead["tag"] == b""
    assert dead["ciphertext"] == b""
    assert dead["byte_size"] == 0
    assert dead["deleted"] is True

    # Column is NOT NULL after the migration (can't be re-added as NULL by a
    # future stray insert without a tag).
    async def _tag_is_not_nullable() -> bool:
        conn = await asyncpg.connect(DSN)
        try:
            row = await conn.fetchrow(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'synced_epub' AND column_name = 'tag'"
            )
            return row["is_nullable"] == "NO"
        finally:
            await conn.close()

    assert asyncio.run(_tag_is_not_nullable())


def test_0026_downgrade_restores_ciphertext_and_byte_size():
    """`downgrade()` is the inverse of `upgrade()`'s split: re-append `tag`
    onto `ciphertext` and restore `byte_size`, then drop the column. Exercises
    the actual `downgrade()` SQL end-to-end (upgrade → downgrade round-trip)
    — a broken byte_size/ciphertext expression there would otherwise ship
    undetected, since the forward-migration test never calls `downgrade`."""
    cfg = _alembic_config()

    # Start from a clean 0025 state, same re-runnable dance as the forward test.
    if asyncio.run(_has_tag_column()):
        command.downgrade(cfg, "0025")
    assert _current_revision() == "0025"

    owner_id = asyncio.run(_make_account())

    # Inc-2-shaped row: ciphertext = ct‖tag(16), byte_size = len(ct‖tag).
    ct = bytes(range(30, 30 + 24))
    tag = bytes([0xBB]) * 16
    ct_plus_tag = ct + tag
    asyncio.run(
        _seed(
            owner_account_id=owner_id,
            epub_id="round-trip-1",
            ciphertext=ct_plus_tag,
            byte_size=len(ct_plus_tag),
            deleted=False,
            meta_ciphertext=b"META-RT",
        )
    )

    command.upgrade(cfg, "0026")
    assert _current_revision() == "0026"
    split = asyncio.run(_fetch_row(owner_account_id=owner_id, epub_id="round-trip-1"))
    assert split["tag"] == tag
    assert split["ciphertext"] == ct
    assert split["byte_size"] == len(ct)

    command.downgrade(cfg, "0025")
    assert _current_revision() == "0025"
    assert not asyncio.run(_has_tag_column())

    async def _fetch_downgraded() -> asyncpg.Record:
        conn = await asyncpg.connect(DSN)
        try:
            row = await conn.fetchrow(
                "SELECT ciphertext, byte_size FROM synced_epub "
                "WHERE owner_account_id = $1 AND epub_id = $2",
                owner_id,
                "round-trip-1",
            )
            assert row is not None
            return row
        finally:
            await conn.close()

    restored = asyncio.run(_fetch_downgraded())
    assert restored["ciphertext"] == ct_plus_tag
    assert restored["byte_size"] == len(ct_plus_tag)

    # Leave the DB at head for every other DB-backed test module.
    command.upgrade(cfg, "0026")
    assert _current_revision() == "0026"
    assert asyncio.run(_has_tag_column())
