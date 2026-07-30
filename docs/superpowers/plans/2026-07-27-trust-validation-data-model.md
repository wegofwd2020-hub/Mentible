# Trust/Validation Data Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend persistence layer for ADR-037's four-phase workflow — projects, inputs, artifacts + immutable revisions, version-level source traceability, feedback, and append-only expert-approval records — plus the share-ready single access-guard.

**Architecture:** Raw asyncpg + one hand-written Alembic migration (`0009`), a per-domain repo layer under `backend/src/trust/` (async functions taking a `conn`, returning frozen dataclasses), and a single `require_project_access()` guard that is owner-only now and extends to membership later. No API routers, no UI (later sub-projects).

**Tech Stack:** Python 3.11, asyncpg, Alembic (raw `op.execute` SQL), pytest against a real migrated Postgres (transaction-per-test rollback).

**Spec:** `docs/superpowers/specs/2026-07-27-trust-validation-data-model-design.md`.

## Global Constraints

- Migration file: `backend/alembic/versions/0009_trust_validation.py`, `revision = "0009"`, `down_revision = "0008"`, raw `op.execute("""...""")` SQL only (no autogenerate).
- All new code under `backend/src/trust/`. All tests under `backend/tests/`, named `test_trust_*.py`.
- Scoping anchor: `project.owner_account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE`. Children cascade through the FK chain.
- Enums: `text + CHECK (col IN (...))` in DDL **and** a Python tuple constant in `models.py`, validated in the repo (raise `ValueError`) before insert.
- `approval` and `artifact_version` are **append-only / immutable**: repos expose insert + read only; **no update/delete functions exist**.
- SQL uses `$1` positional params only (never f-strings — ruff S608). `jsonb` bound as `json.dumps(x)` with `$n::jsonb`, read with `json.loads`.
- Dataclasses are `@dataclass(frozen=True)`, mapped from rows via a private `_row(...)` helper per repo.
- **DB tests require a migrated Postgres.** They `skipif(not os.environ.get("DATABASE_URL"))` (house pattern). To run: point `DATABASE_URL` at a scratch PG, `cd backend && alembic upgrade head`, then `pytest`. Without `DATABASE_URL` they skip (same as existing `test_accounts_repo.py` — this is the established idiom; note it does mean CI without a PG will skip them).
- **Tooling paths (verified):** the venv is `backend/.venv` and has `pytest`/`alembic`/`asyncpg` — but **`ruff` is NOT in the venv**; it's on `PATH` at `~/.local/bin/ruff`. Run lint/format as `ruff check ...` / `ruff format ...` (NOT `.venv/bin/ruff`, which does not exist and silently errors).
- **S608 on the repo column-list constants:** the `_P`/`_I`/`_A`/`_V`/`_F`/`_AP` column-list constants interpolated into f-string SQL trip ruff `S608` (they are static literals, never user input; all values bind via `$1`). Resolve **once** with a per-file-ignore in `backend/pyproject.toml` under `[tool.ruff.lint.per-file-ignores]`: add `"src/trust/*_repo.py" = ["S608"]` (house already ignores per-file for `tests/**` and `owner_cli.py`). With that line, every `*_repo.py` in this plan lints clean as written — no per-statement `# noqa` needed. This config line is part of Task 4's deliverable.

---

### Task 1: Migration `0009` — all seven tables

**Files:**
- Create: `backend/alembic/versions/0009_trust_validation.py`
- Test: `backend/tests/test_trust_schema.py`

**Interfaces:**
- Produces: tables `project`, `project_input`, `artifact`, `artifact_version`, `artifact_version_source`, `feedback`, `approval` with the columns/constraints below. All later tasks depend on this schema.

- [ ] **Step 1: Write the failing schema test**

```python
# backend/tests/test_trust_schema.py
import os
import asyncpg
import pytest

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no trust DB)"),
]

TABLES = [
    "project", "project_input", "artifact", "artifact_version",
    "artifact_version_source", "feedback", "approval",
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
    exists = await conn.fetchval(
        "SELECT to_regclass($1)", f"public.{table}"
    )
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
    assert row["confdeltype"] == "c", "FK should be ON DELETE CASCADE"

async def test_artifact_version_unique(conn):
    n = await conn.fetchval(
        """
        SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'artifact_version'::regclass AND contype = 'u'
        """
    )
    assert n >= 1, "UNIQUE(artifact_id, version_no) missing"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_schema.py -v`
Expected: FAIL/ERROR — tables don't exist (`to_regclass` returns None). (If `DATABASE_URL` unset it SKIPS — set it to a scratch PG first, per Global Constraints.)

- [ ] **Step 3: Write the migration**

```python
# backend/alembic/versions/0009_trust_validation.py
"""trust/validation data model (ADR-037 sub-project b)"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE project (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            title             text NOT NULL,
            topic             text,
            audience          text,
            goal              text,
            status            text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','archived')),
            created_at        timestamptz NOT NULL DEFAULT now(),
            updated_at        timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX project_owner_idx ON project (owner_account_id);

        CREATE TABLE project_input (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            kind          text NOT NULL
                          CHECK (kind IN ('transcript','note','upload','link')),
            title         text,
            content       text,
            source_ref    text,
            storage_path  text,
            content_hash  text,
            created_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX project_input_project_idx ON project_input (project_id);

        CREATE TABLE artifact (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            role        text NOT NULL CHECK (role IN ('cornerstone','derivative')),
            format      text NOT NULL CHECK (format IN
                        ('book','guide','learning_module','podcast',
                         'youtube','reel','linkedin','x_thread')),
            title       text,
            created_at  timestamptz NOT NULL DEFAULT now(),
            updated_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX artifact_project_idx ON artifact (project_id);

        CREATE TABLE artifact_version (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            artifact_id      uuid NOT NULL REFERENCES artifact(id) ON DELETE CASCADE,
            version_no       integer NOT NULL,
            content          jsonb NOT NULL,
            generation_meta  jsonb,
            created_by_sub   text NOT NULL,
            created_at       timestamptz NOT NULL DEFAULT now(),
            UNIQUE (artifact_id, version_no)
        );
        CREATE INDEX artifact_version_artifact_idx ON artifact_version (artifact_id);

        CREATE TABLE artifact_version_source (
            version_id  uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE,
            input_id    uuid NOT NULL REFERENCES project_input(id) ON DELETE CASCADE,
            PRIMARY KEY (version_id, input_id)
        );

        CREATE TABLE feedback (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            version_id       uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE,
            author_kind      text NOT NULL CHECK (author_kind IN ('expert','operator')),
            author_name      text,
            body             text NOT NULL,
            recorded_by_sub  text NOT NULL,
            created_at       timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX feedback_version_idx ON feedback (version_id);

        CREATE TABLE approval (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            version_id       uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE,
            expert_name      text NOT NULL,
            expert_email     text,
            expert_role      text,
            approved_at      timestamptz NOT NULL,
            recorded_by_sub  text NOT NULL,
            recorded_at      timestamptz NOT NULL DEFAULT now(),
            note             text
        );
        CREATE INDEX approval_version_idx ON approval (version_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS approval;
        DROP TABLE IF EXISTS feedback;
        DROP TABLE IF EXISTS artifact_version_source;
        DROP TABLE IF EXISTS artifact_version;
        DROP TABLE IF EXISTS artifact;
        DROP TABLE IF EXISTS project_input;
        DROP TABLE IF EXISTS project;
        """
    )
```

- [ ] **Step 4: Apply the migration and run the test**

Run: `cd backend && alembic upgrade head && pytest tests/test_trust_schema.py -v`
Expected: PASS (7 tables exist, FK cascade, UNIQUE present).

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0009_trust_validation.py backend/tests/test_trust_schema.py
git commit -m "feat(trust): migration 0009 — trust/validation tables (ADR-037 b)"
```

---

### Task 2: `models.py` — dataclasses + enum tuples

**Files:**
- Create: `backend/src/trust/__init__.py` (empty)
- Create: `backend/src/trust/models.py`
- Test: `backend/tests/test_trust_models.py`

**Interfaces:**
- Produces: frozen dataclasses `Project`, `ProjectInput`, `Artifact`, `ArtifactVersion`, `Feedback`, `Approval`; tuples `PROJECT_STATUSES`, `INPUT_KINDS`, `ARTIFACT_ROLES`, `ARTIFACT_FORMATS`, `FEEDBACK_AUTHOR_KINDS`. Consumed by every repo.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_models.py
from src.trust import models

def test_enum_tuples():
    assert models.PROJECT_STATUSES == ("active", "archived")
    assert models.INPUT_KINDS == ("transcript", "note", "upload", "link")
    assert models.ARTIFACT_ROLES == ("cornerstone", "derivative")
    assert "book" in models.ARTIFACT_FORMATS and "x_thread" in models.ARTIFACT_FORMATS
    assert models.FEEDBACK_AUTHOR_KINDS == ("expert", "operator")

def test_dataclasses_frozen():
    import dataclasses
    p = models.Project(
        id="00000000-0000-0000-0000-000000000000",
        owner_account_id="00000000-0000-0000-0000-000000000001",
        title="T", topic=None, audience=None, goal=None,
        status="active", created_at=None, updated_at=None,
    )
    assert p.title == "T"
    with_ = dataclasses.replace  # frozen: mutation must go through replace
    assert with_(p, title="U").title == "U"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_models.py -v`
Expected: FAIL — `ModuleNotFoundError: src.trust`.

- [ ] **Step 3: Write the models**

```python
# backend/src/trust/models.py
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime

PROJECT_STATUSES = ("active", "archived")
INPUT_KINDS = ("transcript", "note", "upload", "link")
ARTIFACT_ROLES = ("cornerstone", "derivative")
ARTIFACT_FORMATS = (
    "book", "guide", "learning_module", "podcast",
    "youtube", "reel", "linkedin", "x_thread",
)
FEEDBACK_AUTHOR_KINDS = ("expert", "operator")


@dataclass(frozen=True)
class Project:
    id: str
    owner_account_id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class ProjectInput:
    id: str
    project_id: str
    kind: str
    title: str | None
    content: str | None
    source_ref: str | None
    storage_path: str | None
    content_hash: str | None
    created_at: datetime | None


@dataclass(frozen=True)
class Artifact:
    id: str
    project_id: str
    role: str
    format: str
    title: str | None
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class ArtifactVersion:
    id: str
    artifact_id: str
    version_no: int
    content: object          # parsed jsonb
    generation_meta: object | None
    created_by_sub: str
    created_at: datetime | None


@dataclass(frozen=True)
class Feedback:
    id: str
    version_id: str
    author_kind: str
    author_name: str | None
    body: str
    recorded_by_sub: str
    created_at: datetime | None


@dataclass(frozen=True)
class Approval:
    id: str
    version_id: str
    expert_name: str
    expert_email: str | None
    expert_role: str | None
    approved_at: datetime
    recorded_by_sub: str
    recorded_at: datetime | None
    note: str | None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_trust_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/__init__.py backend/src/trust/models.py backend/tests/test_trust_models.py
git commit -m "feat(trust): dataclasses + enum tuples (ADR-037 b)"
```

---

### Task 3: `access.py` — the single project access-guard

**Files:**
- Create: `backend/src/trust/access.py`
- Test: `backend/tests/test_trust_access.py`

**Interfaces:**
- Consumes: the `project` table (Task 1).
- Produces: `ProjectAccessError`, `async require_project_access(conn, *, account_id, project_id) -> str`. Consumed by future routers (out of scope) and referenced by the seam.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_access.py
import os, uuid
import asyncpg
import pytest
from src.trust.access import require_project_access, ProjectAccessError

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not DSN, reason="DATABASE_URL not set"),
]

@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction()
    await tx.start()
    try:
        yield c
    finally:
        await tx.rollback()
        await c.close()

async def _make_account(conn) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id",
        f"sub-{uuid.uuid4()}",
    )

async def _make_project(conn, owner) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO project (owner_account_id, title) VALUES ($1,$2) RETURNING id",
        owner, "P",
    )

async def test_owner_gets_owner_role(conn):
    acc = await _make_account(conn)
    proj = await _make_project(conn, acc)
    role = await require_project_access(conn, account_id=acc, project_id=proj)
    assert role == "owner"

async def test_other_account_denied(conn):
    owner = await _make_account(conn)
    other = await _make_account(conn)
    proj = await _make_project(conn, owner)
    with pytest.raises(ProjectAccessError):
        await require_project_access(conn, account_id=other, project_id=proj)

async def test_missing_project_denied(conn):
    acc = await _make_account(conn)
    with pytest.raises(ProjectAccessError):
        await require_project_access(conn, account_id=acc, project_id=uuid.uuid4())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_access.py -v`
Expected: FAIL — `ModuleNotFoundError: src.trust.access`.

- [ ] **Step 3: Write the guard**

```python
# backend/src/trust/access.py
"""The single place project authorization is decided (ADR-037 D4 seam).

MVP: owner-only. When expert-login lands (sub-project c), add a
project_membership table and ONE `OR EXISTS (...)` branch here — endpoints
and child repos are untouched.
"""
from __future__ import annotations
import uuid
import asyncpg

PROJECT_ROLES = ("owner",)  # + "reviewer" later


class ProjectAccessError(Exception):
    """Caller has no access to the project. Routers map this to HTTP 403."""


async def require_project_access(
    conn: asyncpg.Connection, *, account_id: uuid.UUID, project_id: uuid.UUID
) -> str:
    owner = await conn.fetchval(
        "SELECT owner_account_id FROM project WHERE id = $1", project_id
    )
    if owner is None or owner != account_id:
        raise ProjectAccessError(str(project_id))
    return "owner"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_trust_access.py -v`
Expected: PASS (owner → "owner"; other account and missing project → `ProjectAccessError`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/access.py backend/tests/test_trust_access.py
git commit -m "feat(trust): single require_project_access guard (ADR-037 D4 seam)"
```

---

### Task 4: `project_repo.py` — projects + inputs

**Files:**
- Create: `backend/src/trust/project_repo.py`
- Test: `backend/tests/test_trust_project_repo.py`

**Interfaces:**
- Consumes: `models` (Task 2), the `project`/`project_input` tables (Task 1).
- Produces:
  - `create_project(conn, *, owner_account_id, title, topic=None, audience=None, goal=None) -> Project`
  - `get_project(conn, *, project_id) -> Project | None`
  - `list_projects(conn, *, owner_account_id) -> list[Project]`
  - `set_status(conn, *, project_id, status) -> None`
  - `add_input(conn, *, project_id, kind, title=None, content=None, source_ref=None) -> ProjectInput`
  - `list_inputs(conn, *, project_id) -> list[ProjectInput]`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_project_repo.py
import os, uuid
import asyncpg
import pytest
from src.trust import project_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction(); await tx.start()
    try:
        yield c
    finally:
        await tx.rollback(); await c.close()

async def _account(conn):
    return await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )

async def test_create_and_list_scoped(conn):
    a1 = await _account(conn)
    a2 = await _account(conn)
    p = await project_repo.create_project(conn, owner_account_id=a1, title="Stormwater")
    assert p.title == "Stormwater" and p.status == "active"
    assert [x.id for x in await project_repo.list_projects(conn, owner_account_id=a1)] == [p.id]
    assert await project_repo.list_projects(conn, owner_account_id=a2) == []

async def test_set_status_validates(conn):
    a = await _account(conn)
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    await project_repo.set_status(conn, project_id=p.id, status="archived")
    assert (await project_repo.get_project(conn, project_id=p.id)).status == "archived"
    with pytest.raises(ValueError):
        await project_repo.set_status(conn, project_id=p.id, status="bogus")

async def test_add_and_list_inputs(conn):
    a = await _account(conn)
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    i = await project_repo.add_input(conn, project_id=p.id, kind="transcript",
                                     title="Interview 1", content="hello")
    assert i.kind == "transcript" and i.content == "hello"
    assert [x.id for x in await project_repo.list_inputs(conn, project_id=p.id)] == [i.id]
    with pytest.raises(ValueError):
        await project_repo.add_input(conn, project_id=p.id, kind="bogus", content="x")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_project_repo.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the repo**

```python
# backend/src/trust/project_repo.py
from __future__ import annotations
import uuid
import asyncpg
from .models import Project, ProjectInput, PROJECT_STATUSES, INPUT_KINDS

_P = "id, owner_account_id, title, topic, audience, goal, status, created_at, updated_at"
_I = "id, project_id, kind, title, content, source_ref, storage_path, content_hash, created_at"


def _project(r) -> Project:
    return Project(**{k: r[k] for k in (
        "id", "owner_account_id", "title", "topic", "audience", "goal",
        "status", "created_at", "updated_at")})


def _input(r) -> ProjectInput:
    return ProjectInput(**{k: r[k] for k in (
        "id", "project_id", "kind", "title", "content", "source_ref",
        "storage_path", "content_hash", "created_at")})


async def create_project(conn, *, owner_account_id, title,
                         topic=None, audience=None, goal=None) -> Project:
    r = await conn.fetchrow(
        f"INSERT INTO project (owner_account_id, title, topic, audience, goal) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_P}",
        owner_account_id, title, topic, audience, goal,
    )
    return _project(r)


async def get_project(conn, *, project_id) -> Project | None:
    r = await conn.fetchrow(f"SELECT {_P} FROM project WHERE id = $1", project_id)
    return _project(r) if r else None


async def list_projects(conn, *, owner_account_id) -> list[Project]:
    rows = await conn.fetch(
        f"SELECT {_P} FROM project WHERE owner_account_id = $1 "
        f"ORDER BY created_at DESC, id DESC",
        owner_account_id,
    )
    return [_project(r) for r in rows]


async def set_status(conn, *, project_id, status) -> None:
    if status not in PROJECT_STATUSES:
        raise ValueError(f"invalid status {status!r}")
    await conn.execute(
        "UPDATE project SET status = $2, updated_at = now() WHERE id = $1",
        project_id, status,
    )


async def add_input(conn, *, project_id, kind, title=None, content=None,
                    source_ref=None) -> ProjectInput:
    if kind not in INPUT_KINDS:
        raise ValueError(f"invalid kind {kind!r}")
    r = await conn.fetchrow(
        f"INSERT INTO project_input (project_id, kind, title, content, source_ref) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_I}",
        project_id, kind, title, content, source_ref,
    )
    return _input(r)


async def list_inputs(conn, *, project_id) -> list[ProjectInput]:
    rows = await conn.fetch(
        f"SELECT {_I} FROM project_input WHERE project_id = $1 ORDER BY created_at, id",
        project_id,
    )
    return [_input(r) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_trust_project_repo.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/project_repo.py backend/tests/test_trust_project_repo.py
git commit -m "feat(trust): project + input repo (ADR-037 b)"
```

---

### Task 5: `artifact_repo.py` — artifacts, immutable versions, source links

**Files:**
- Create: `backend/src/trust/artifact_repo.py`
- Test: `backend/tests/test_trust_artifact_repo.py`

**Interfaces:**
- Consumes: `models` (Task 2), `project_repo` (Task 4, for test setup), the `artifact`/`artifact_version`/`artifact_version_source` tables.
- Produces:
  - `create_artifact(conn, *, project_id, role, format, title=None) -> Artifact`
  - `list_artifacts(conn, *, project_id) -> list[Artifact]`
  - `create_version(conn, *, artifact_id, content, created_by_sub, generation_meta=None) -> ArtifactVersion` (auto-increment `version_no`)
  - `list_versions(conn, *, artifact_id) -> list[ArtifactVersion]`
  - `add_version_sources(conn, *, version_id, input_ids) -> None`
  - `list_version_sources(conn, *, version_id) -> list[str]`
  - There is intentionally **no** `update_version` / `delete_version`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_artifact_repo.py
import os, uuid
import asyncpg
import pytest
from src.trust import project_repo, artifact_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction(); await tx.start()
    try:
        yield c
    finally:
        await tx.rollback(); await c.close()

async def _project(conn):
    a = await conn.fetchval("INSERT INTO account (idp_sub) VALUES ($1) RETURNING id",
                            f"s-{uuid.uuid4()}")
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    return p

async def test_create_artifact_validates_enums(conn):
    p = await _project(conn)
    art = await artifact_repo.create_artifact(conn, project_id=p.id,
                                              role="cornerstone", format="book", title="Guide")
    assert art.role == "cornerstone" and art.format == "book"
    with pytest.raises(ValueError):
        await artifact_repo.create_artifact(conn, project_id=p.id, role="bogus", format="book")
    with pytest.raises(ValueError):
        await artifact_repo.create_artifact(conn, project_id=p.id, role="derivative", format="bogus")

async def test_versions_monotonic_and_sources(conn):
    p = await _project(conn)
    art = await artifact_repo.create_artifact(conn, project_id=p.id,
                                              role="derivative", format="linkedin")
    v1 = await artifact_repo.create_version(conn, artifact_id=art.id,
                                            content={"text": "a"}, created_by_sub="op")
    v2 = await artifact_repo.create_version(conn, artifact_id=art.id,
                                            content={"text": "b"}, created_by_sub="op")
    assert (v1.version_no, v2.version_no) == (1, 2)
    assert v1.content == {"text": "a"}
    i = await project_repo.add_input(conn, project_id=p.id, kind="note", content="src")
    await artifact_repo.add_version_sources(conn, version_id=v1.id, input_ids=[i.id])
    assert await artifact_repo.list_version_sources(conn, version_id=v1.id) == [str(i.id)]

async def test_no_update_delete_api(conn):
    assert not hasattr(artifact_repo, "update_version")
    assert not hasattr(artifact_repo, "delete_version")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_artifact_repo.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the repo**

```python
# backend/src/trust/artifact_repo.py
from __future__ import annotations
import json
import uuid
import asyncpg
from .models import (
    Artifact, ArtifactVersion, ARTIFACT_ROLES, ARTIFACT_FORMATS,
)

_A = "id, project_id, role, format, title, created_at, updated_at"
_V = "id, artifact_id, version_no, content, generation_meta, created_by_sub, created_at"


def _artifact(r) -> Artifact:
    return Artifact(**{k: r[k] for k in
                       ("id", "project_id", "role", "format", "title",
                        "created_at", "updated_at")})


def _version(r) -> ArtifactVersion:
    return ArtifactVersion(
        id=r["id"], artifact_id=r["artifact_id"], version_no=r["version_no"],
        content=json.loads(r["content"]) if r["content"] is not None else None,
        generation_meta=(json.loads(r["generation_meta"])
                         if r["generation_meta"] is not None else None),
        created_by_sub=r["created_by_sub"], created_at=r["created_at"],
    )


async def create_artifact(conn, *, project_id, role, format, title=None) -> Artifact:
    if role not in ARTIFACT_ROLES:
        raise ValueError(f"invalid role {role!r}")
    if format not in ARTIFACT_FORMATS:
        raise ValueError(f"invalid format {format!r}")
    r = await conn.fetchrow(
        f"INSERT INTO artifact (project_id, role, format, title) "
        f"VALUES ($1,$2,$3,$4) RETURNING {_A}",
        project_id, role, format, title,
    )
    return _artifact(r)


async def list_artifacts(conn, *, project_id) -> list[Artifact]:
    rows = await conn.fetch(
        f"SELECT {_A} FROM artifact WHERE project_id = $1 ORDER BY created_at, id",
        project_id,
    )
    return [_artifact(r) for r in rows]


async def create_version(conn, *, artifact_id, content, created_by_sub,
                         generation_meta=None) -> ArtifactVersion:
    r = await conn.fetchrow(
        f"""
        INSERT INTO artifact_version
            (artifact_id, version_no, content, generation_meta, created_by_sub)
        VALUES (
            $1,
            (SELECT COALESCE(MAX(version_no),0)+1 FROM artifact_version WHERE artifact_id=$1),
            $2::jsonb, $3::jsonb, $4
        )
        RETURNING {_V}
        """,
        artifact_id, json.dumps(content),
        json.dumps(generation_meta) if generation_meta is not None else None,
        created_by_sub,
    )
    return _version(r)


async def list_versions(conn, *, artifact_id) -> list[ArtifactVersion]:
    rows = await conn.fetch(
        f"SELECT {_V} FROM artifact_version WHERE artifact_id = $1 ORDER BY version_no",
        artifact_id,
    )
    return [_version(r) for r in rows]


async def add_version_sources(conn, *, version_id, input_ids) -> None:
    for input_id in input_ids:
        await conn.execute(
            "INSERT INTO artifact_version_source (version_id, input_id) "
            "VALUES ($1,$2) ON CONFLICT DO NOTHING",
            version_id, input_id,
        )


async def list_version_sources(conn, *, version_id) -> list[str]:
    rows = await conn.fetch(
        "SELECT input_id FROM artifact_version_source WHERE version_id = $1 "
        "ORDER BY input_id",
        version_id,
    )
    return [str(r["input_id"]) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_trust_artifact_repo.py -v`
Expected: PASS (enum validation, `version_no` 1 then 2, jsonb round-trip, source link, no update/delete attrs).

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/artifact_repo.py backend/tests/test_trust_artifact_repo.py
git commit -m "feat(trust): artifact + immutable version + source-link repo (ADR-037 b)"
```

---

### Task 6: `feedback_repo.py` — expert/operator feedback

**Files:**
- Create: `backend/src/trust/feedback_repo.py`
- Test: `backend/tests/test_trust_feedback_repo.py`

**Interfaces:**
- Consumes: `models` (Task 2), `project_repo`/`artifact_repo` (test setup), the `feedback` table.
- Produces:
  - `add_feedback(conn, *, version_id, author_kind, body, recorded_by_sub, author_name=None) -> Feedback`
  - `list_feedback(conn, *, version_id) -> list[Feedback]`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_feedback_repo.py
import os, uuid
import asyncpg
import pytest
from src.trust import project_repo, artifact_repo, feedback_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction(); await tx.start()
    try:
        yield c
    finally:
        await tx.rollback(); await c.close()

async def _version(conn):
    a = await conn.fetchval("INSERT INTO account (idp_sub) VALUES ($1) RETURNING id",
                            f"s-{uuid.uuid4()}")
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    art = await artifact_repo.create_artifact(conn, project_id=p.id,
                                              role="cornerstone", format="book")
    return await artifact_repo.create_version(conn, artifact_id=art.id,
                                              content={}, created_by_sub="op")

async def test_add_and_list(conn):
    v = await _version(conn)
    f = await feedback_repo.add_feedback(conn, version_id=v.id, author_kind="expert",
                                         author_name="Dr X", body="tighten intro",
                                         recorded_by_sub="op")
    assert f.author_kind == "expert" and f.author_name == "Dr X"
    assert [x.id for x in await feedback_repo.list_feedback(conn, version_id=v.id)] == [f.id]

async def test_author_kind_validated(conn):
    v = await _version(conn)
    with pytest.raises(ValueError):
        await feedback_repo.add_feedback(conn, version_id=v.id, author_kind="bogus",
                                         body="x", recorded_by_sub="op")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_feedback_repo.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the repo**

```python
# backend/src/trust/feedback_repo.py
from __future__ import annotations
import asyncpg
from .models import Feedback, FEEDBACK_AUTHOR_KINDS

_F = "id, version_id, author_kind, author_name, body, recorded_by_sub, created_at"


def _feedback(r) -> Feedback:
    return Feedback(**{k: r[k] for k in
                       ("id", "version_id", "author_kind", "author_name",
                        "body", "recorded_by_sub", "created_at")})


async def add_feedback(conn, *, version_id, author_kind, body, recorded_by_sub,
                       author_name=None) -> Feedback:
    if author_kind not in FEEDBACK_AUTHOR_KINDS:
        raise ValueError(f"invalid author_kind {author_kind!r}")
    r = await conn.fetchrow(
        f"INSERT INTO feedback (version_id, author_kind, author_name, body, recorded_by_sub) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_F}",
        version_id, author_kind, author_name, body, recorded_by_sub,
    )
    return _feedback(r)


async def list_feedback(conn, *, version_id) -> list[Feedback]:
    rows = await conn.fetch(
        f"SELECT {_F} FROM feedback WHERE version_id = $1 ORDER BY created_at, id",
        version_id,
    )
    return [_feedback(r) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_trust_feedback_repo.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/feedback_repo.py backend/tests/test_trust_feedback_repo.py
git commit -m "feat(trust): feedback repo (ADR-037 b)"
```

---

### Task 7: `approval_repo.py` — append-only expert approval + `is_validated`

**Files:**
- Create: `backend/src/trust/approval_repo.py`
- Test: `backend/tests/test_trust_approval_repo.py`

**Interfaces:**
- Consumes: `models` (Task 2), `project_repo`/`artifact_repo` (test setup), the `approval` table.
- Produces:
  - `record_approval(conn, *, version_id, expert_name, approved_at, recorded_by_sub, expert_email=None, expert_role=None, note=None) -> Approval`
  - `get_approval(conn, *, version_id) -> Approval | None`
  - `is_validated(conn, *, version_id) -> bool`
  - Intentionally **no** update/delete.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_approval_repo.py
import os, uuid
from datetime import datetime, timezone
import asyncpg
import pytest
from src.trust import project_repo, artifact_repo, approval_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction(); await tx.start()
    try:
        yield c
    finally:
        await tx.rollback(); await c.close()

async def _version(conn):
    a = await conn.fetchval("INSERT INTO account (idp_sub) VALUES ($1) RETURNING id",
                            f"s-{uuid.uuid4()}")
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    art = await artifact_repo.create_artifact(conn, project_id=p.id,
                                              role="cornerstone", format="book")
    return await artifact_repo.create_version(conn, artifact_id=art.id,
                                              content={}, created_by_sub="op")

async def test_validation_flips_only_after_approval(conn):
    v = await _version(conn)
    assert await approval_repo.is_validated(conn, version_id=v.id) is False
    ap = await approval_repo.record_approval(
        conn, version_id=v.id, expert_name="Dr X",
        approved_at=datetime.now(timezone.utc), recorded_by_sub="op",
        expert_role="civil engineer", note="approved",
    )
    assert ap.expert_name == "Dr X"
    assert await approval_repo.is_validated(conn, version_id=v.id) is True
    assert (await approval_repo.get_approval(conn, version_id=v.id)).id == ap.id

async def test_append_only_no_mutators(conn):
    assert not hasattr(approval_repo, "update_approval")
    assert not hasattr(approval_repo, "delete_approval")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_trust_approval_repo.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the repo**

```python
# backend/src/trust/approval_repo.py
"""Append-only expert-approval records (ADR-037 D4).

A version is 'expert validated' IFF an approval row exists for it. There is
deliberately NO update or delete path — approval is immutable trust evidence.
"""
from __future__ import annotations
import asyncpg
from .models import Approval

_AP = ("id, version_id, expert_name, expert_email, expert_role, "
       "approved_at, recorded_by_sub, recorded_at, note")


def _approval(r) -> Approval:
    return Approval(**{k: r[k] for k in
                       ("id", "version_id", "expert_name", "expert_email",
                        "expert_role", "approved_at", "recorded_by_sub",
                        "recorded_at", "note")})


async def record_approval(conn, *, version_id, expert_name, approved_at,
                          recorded_by_sub, expert_email=None, expert_role=None,
                          note=None) -> Approval:
    r = await conn.fetchrow(
        f"INSERT INTO approval (version_id, expert_name, expert_email, expert_role, "
        f"approved_at, recorded_by_sub, note) "
        f"VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING {_AP}",
        version_id, expert_name, expert_email, expert_role,
        approved_at, recorded_by_sub, note,
    )
    return _approval(r)


async def get_approval(conn, *, version_id) -> Approval | None:
    r = await conn.fetchrow(
        f"SELECT {_AP} FROM approval WHERE version_id = $1 "
        f"ORDER BY recorded_at DESC, id DESC LIMIT 1",
        version_id,
    )
    return _approval(r) if r else None


async def is_validated(conn, *, version_id) -> bool:
    return bool(await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM approval WHERE version_id = $1)", version_id
    ))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_trust_approval_repo.py -v`
Expected: PASS (`is_validated` False→True after recording; no mutators).

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/approval_repo.py backend/tests/test_trust_approval_repo.py
git commit -m "feat(trust): append-only approval repo + is_validated (ADR-037 b)"
```

---

## Final verification

- [ ] Run the whole trust suite: `cd backend && pytest tests/test_trust_*.py -v` — all pass (with `DATABASE_URL` set + `alembic upgrade head`), or cleanly skip without a DB.
- [ ] Lint/format: `cd backend && ruff format src/trust tests/test_trust_*.py && ruff check src/trust`.
- [ ] Confirm no update/delete exists on `approval` or `artifact_version` (immutability guarantees hold).
- [ ] Confirm every project-scoped concern resolves ownership only via `project.owner_account_id` (the seam is the single guard; no scattered ownership checks).
