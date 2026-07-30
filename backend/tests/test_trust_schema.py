import os

import asyncpg
import pytest

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no trust DB)"),
]

TABLES = [
    "project",
    "project_input",
    "artifact",
    "artifact_version",
    "artifact_version_source",
    "feedback",
    "approval",
]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    try:
        yield c
    finally:
        await c.close()


@pytest.mark.parametrize("table", TABLES)
async def test_table_exists(conn, table):
    exists = await conn.fetchval("SELECT to_regclass($1)", f"public.{table}")
    assert exists is not None, f"missing table {table}"


async def test_project_owner_fk_and_cascade(conn):
    row = await conn.fetchrow(
        """
        SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'project'::regclass AND contype = 'f'
          AND confrelid = 'account'::regclass
        """
    )
    assert row is not None, "project.owner_account_id FK to account missing"
    confdeltype = row["confdeltype"]
    if isinstance(confdeltype, bytes):
        confdeltype = confdeltype.decode()
    assert confdeltype == "c", "FK should be ON DELETE CASCADE"


async def test_artifact_version_unique(conn):
    n = await conn.fetchval(
        """
        SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'artifact_version'::regclass AND contype = 'u'
        """
    )
    assert n >= 1, "UNIQUE(artifact_id, version_no) missing"
