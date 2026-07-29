# Trust Expert-Login (Multi-Actor Access) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the authorization model that lets a named expert log in and gain scoped `reviewer` access to one project — `project_membership` + email `project_invitation` + a redeem-on-login bridge + the guard extension + the `project_id_for_{artifact,version}` resolvers + an `approval.recorded_via` provenance signal.

**Architecture:** One Alembic migration (`0010`) on top of (b)'s `0009`; extend `backend/src/trust/` (new `membership_repo.py`, extend `access.py`/`models.py`/`approval_repo.py`). App-level authorization only — extend the existing `require_project_access` guard with one membership branch. No HTTP router, no UI, no login wiring (those compose these functions later).

**Tech Stack:** Python 3.11, asyncpg, Alembic (raw `op.execute` SQL), pytest vs a live migrated Postgres (txn-rollback).

**Spec:** `docs/superpowers/specs/2026-07-27-trust-expert-login-design.md`.

## Global Constraints

- Migration `backend/alembic/versions/0010_trust_membership.py`, `revision = "0010"`, `down_revision = "0009"`, raw `op.execute` SQL, **one statement per `op.execute` call** (asyncpg cannot run multiple statements in one prepared query).
- All new code under `backend/src/trust/`; tests `backend/tests/test_trust_*.py`.
- `project_membership.account_id uuid REFERENCES account(id) ON DELETE CASCADE`; `project_invitation` is email-keyed (invitee may have no account yet). Both FK `project_id` to `project(id) ON DELETE CASCADE`.
- Emails stored + compared **lowercased** (`email.lower()`), matching draft-sharing.
- Enums `text + CHECK` in DDL + a Python tuple in `models.py` validated in the repo (raise `ValueError`) before insert.
- App-level authz ONLY — no RLS, no `user_roles`/`has_role`.
- **Tooling:** `ruff` is on PATH at `~/.local/bin/ruff` (NOT `backend/.venv/bin/ruff` — that does not exist). Run `ruff check ...` / `ruff format --check ...`. The `"src/trust/*_repo.py" = ["S608"]` per-file-ignore already exists in `pyproject.toml` and covers `membership_repo.py`.
- **DB tests** require a migrated Postgres and `skipif(not os.environ.get("DATABASE_URL"))`. To run: `cd backend && DATABASE_URL=<dsn> alembic upgrade head` then `DATABASE_URL=<dsn> .venv/bin/pytest ...` (`pytest`/`alembic` are in `backend/.venv`; `ruff` is not). The test DB is already at `0009`; applying head brings it to `0010`.
- `approval` stays **append-only** — no update/delete added anywhere.

---

### Task 1: Migration `0010` — membership, invitation, approval.recorded_via

**Files:**
- Create: `backend/alembic/versions/0010_trust_membership.py`
- Modify: `backend/tests/test_trust_schema.py` (add cases)

**Interfaces:**
- Produces: tables `project_membership`, `project_invitation`; column `approval.recorded_via`. All later tasks depend on this schema.

- [ ] **Step 1: Add failing schema cases**

Append to `backend/tests/test_trust_schema.py`:

```python
async def test_membership_tables_exist(conn):
    for t in ("project_membership", "project_invitation"):
        assert await conn.fetchval("SELECT to_regclass($1)", f"public.{t}") is not None, t

async def test_membership_pk_and_invite_unique(conn):
    pk = await conn.fetchval(
        "SELECT count(*) FROM pg_constraint "
        "WHERE conrelid='project_membership'::regclass AND contype='p'"
    )
    assert pk == 1, "project_membership PK missing"
    uq = await conn.fetchval(
        "SELECT count(*) FROM pg_constraint "
        "WHERE conrelid='project_invitation'::regclass AND contype='u'"
    )
    assert uq >= 1, "project_invitation UNIQUE(project_id, invited_email) missing"

async def test_approval_recorded_via_column(conn):
    col = await conn.fetchval(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='approval' AND column_name='recorded_via'"
    )
    assert col == "recorded_via"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_schema.py -k "membership or recorded_via" -v`
Expected: FAIL — new objects don't exist. (Set `DSN` to your test DSN; without `DATABASE_URL` it SKIPS.)

- [ ] **Step 3: Write the migration**

```python
# backend/alembic/versions/0010_trust_membership.py
"""trust expert-login: membership, invitation, approval provenance (ADR-037 c)"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE project_membership (
            project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            role        text NOT NULL CHECK (role IN ('owner','reviewer')),
            created_at  timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (project_id, account_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX project_membership_account_idx ON project_membership (account_id)"
    )
    op.execute(
        """
        CREATE TABLE project_invitation (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            invited_email   text NOT NULL,
            role            text NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer')),
            invited_by_sub  text NOT NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),
            revoked_at      timestamptz,
            UNIQUE (project_id, invited_email)
        )
        """
    )
    op.execute(
        "CREATE INDEX project_invitation_email_idx ON project_invitation (invited_email) "
        "WHERE revoked_at IS NULL"
    )
    op.execute(
        "ALTER TABLE approval ADD COLUMN recorded_via text NOT NULL DEFAULT 'operator' "
        "CHECK (recorded_via IN ('operator','expert_self'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE approval DROP COLUMN recorded_via")
    op.execute("DROP TABLE IF EXISTS project_invitation")
    op.execute("DROP TABLE IF EXISTS project_membership")
```

- [ ] **Step 4: Apply + re-run**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/alembic upgrade head && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_schema.py -v`
Expected: PASS (all schema cases, old + new).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check alembic/versions/0010_trust_membership.py tests/test_trust_schema.py && ruff format --check alembic/versions/0010_trust_membership.py tests/test_trust_schema.py
git add backend/alembic/versions/0010_trust_membership.py backend/tests/test_trust_schema.py
git commit -m "feat(trust): migration 0010 — membership, invitation, approval.recorded_via (ADR-037 c)"
```

---

### Task 2: `models.py` — Membership/Invitation dataclasses + role tuples

**Files:**
- Modify: `backend/src/trust/models.py`
- Modify: `backend/tests/test_trust_models.py`

**Interfaces:**
- Produces: `Membership`, `Invitation` frozen dataclasses; tuples `MEMBERSHIP_ROLES = ("owner","reviewer")`, `INVITE_ROLES = ("reviewer",)`, `APPROVAL_VIA = ("operator","expert_self")`. Consumed by Tasks 4 and 5. **Do NOT modify the `Approval` dataclass here — that happens in Task 5.**

- [ ] **Step 1: Add failing test cases**

Append to `backend/tests/test_trust_models.py`:

```python
def test_membership_invite_tuples():
    assert models.MEMBERSHIP_ROLES == ("owner", "reviewer")
    assert models.INVITE_ROLES == ("reviewer",)
    assert models.APPROVAL_VIA == ("operator", "expert_self")

def test_membership_invitation_dataclasses():
    m = models.Membership(
        project_id="p", account_id="a", role="reviewer", created_at=None
    )
    assert m.role == "reviewer"
    inv = models.Invitation(
        id="i", project_id="p", invited_email="x@y.z", role="reviewer",
        invited_by_sub="op", created_at=None, revoked_at=None,
    )
    assert inv.invited_email == "x@y.z" and inv.revoked_at is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_trust_models.py -k "membership" -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'MEMBERSHIP_ROLES'`.

- [ ] **Step 3: Add to `models.py`**

Add the tuples near the other enum tuples:

```python
MEMBERSHIP_ROLES = ("owner", "reviewer")
INVITE_ROLES = ("reviewer",)
APPROVAL_VIA = ("operator", "expert_self")
```

Add the dataclasses at the end of the file:

```python
@dataclass(frozen=True)
class Membership:
    project_id: str
    account_id: str
    role: str
    created_at: datetime | None


@dataclass(frozen=True)
class Invitation:
    id: str
    project_id: str
    invited_email: str
    role: str
    invited_by_sub: str
    created_at: datetime | None
    revoked_at: datetime | None
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && .venv/bin/pytest tests/test_trust_models.py -v`
Expected: PASS (old + new).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/models.py tests/test_trust_models.py && ruff format --check src/trust/models.py tests/test_trust_models.py
git add backend/src/trust/models.py backend/tests/test_trust_models.py
git commit -m "feat(trust): Membership/Invitation models + role tuples (ADR-037 c)"
```

---

### Task 3: `access.py` — membership branch + project resolvers

**Files:**
- Modify: `backend/src/trust/access.py`
- Modify: `backend/tests/test_trust_access.py`

**Interfaces:**
- Consumes: `project`, `project_membership`, `artifact`, `artifact_version` tables.
- Produces: extended `require_project_access` (returns `"owner"` or a membership `role`); `project_id_for_artifact(conn, *, artifact_id) -> uuid.UUID | None`; `project_id_for_version(conn, *, version_id) -> uuid.UUID | None`. `PROJECT_ROLES = ("owner", "reviewer")`.

- [ ] **Step 1: Add failing test cases**

Append to `backend/tests/test_trust_access.py` (the file already has `conn`, `_make_account`, `_make_project` helpers from (b)):

```python
from src.trust.access import project_id_for_artifact, project_id_for_version

async def _make_artifact_version(conn, project_id):
    art = await conn.fetchval(
        "INSERT INTO artifact (project_id, role, format) VALUES ($1,'derivative','linkedin') RETURNING id",
        project_id,
    )
    ver = await conn.fetchval(
        "INSERT INTO artifact_version (artifact_id, version_no, content, created_by_sub) "
        "VALUES ($1, 1, '{}'::jsonb, 'op') RETURNING id",
        art,
    )
    return art, ver

async def test_reviewer_member_gets_role(conn):
    owner = await _make_account(conn)
    reviewer = await _make_account(conn)
    proj = await _make_project(conn, owner)
    await conn.execute(
        "INSERT INTO project_membership (project_id, account_id, role) VALUES ($1,$2,'reviewer')",
        proj, reviewer,
    )
    assert await require_project_access(conn, account_id=reviewer, project_id=proj) == "reviewer"

async def test_non_member_still_denied(conn):
    owner = await _make_account(conn)
    stranger = await _make_account(conn)
    proj = await _make_project(conn, owner)
    with pytest.raises(ProjectAccessError):
        await require_project_access(conn, account_id=stranger, project_id=proj)

async def test_project_id_resolvers(conn):
    owner = await _make_account(conn)
    proj = await _make_project(conn, owner)
    art, ver = await _make_artifact_version(conn, proj)
    assert await project_id_for_artifact(conn, artifact_id=art) == proj
    assert await project_id_for_version(conn, version_id=ver) == proj
    assert await project_id_for_version(conn, version_id=uuid.uuid4()) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_access.py -v`
Expected: FAIL — `ImportError` (resolvers not defined) / reviewer case returns nothing.

- [ ] **Step 3: Rewrite `access.py`**

```python
# backend/src/trust/access.py
"""The single place project authorization is decided (ADR-037 D4 seam).

Owner OR a project_membership row (sub-project c). Still app-level — no RLS.
"""
from __future__ import annotations
import uuid
import asyncpg

PROJECT_ROLES = ("owner", "reviewer")


class ProjectAccessError(Exception):
    """Caller has no access to the project. Routers map this to HTTP 403."""


async def require_project_access(
    conn: asyncpg.Connection, *, account_id: uuid.UUID, project_id: uuid.UUID
) -> str:
    owner = await conn.fetchval(
        "SELECT owner_account_id FROM project WHERE id = $1", project_id
    )
    if owner is None:
        raise ProjectAccessError(str(project_id))
    if owner == account_id:
        return "owner"
    role = await conn.fetchval(
        "SELECT role FROM project_membership WHERE project_id = $1 AND account_id = $2",
        project_id,
        account_id,
    )
    if role is not None:
        return role
    raise ProjectAccessError(str(project_id))


async def project_id_for_artifact(
    conn: asyncpg.Connection, *, artifact_id: uuid.UUID
) -> uuid.UUID | None:
    return await conn.fetchval(
        "SELECT project_id FROM artifact WHERE id = $1", artifact_id
    )


async def project_id_for_version(
    conn: asyncpg.Connection, *, version_id: uuid.UUID
) -> uuid.UUID | None:
    return await conn.fetchval(
        "SELECT a.project_id FROM artifact_version v "
        "JOIN artifact a ON a.id = v.artifact_id WHERE v.id = $1",
        version_id,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_access.py -v`
Expected: PASS — owner→"owner", reviewer→"reviewer", stranger/missing→raises, resolvers map correctly (and None for unknown).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/access.py tests/test_trust_access.py && ruff format --check src/trust/access.py tests/test_trust_access.py
git add backend/src/trust/access.py backend/tests/test_trust_access.py
git commit -m "feat(trust): guard membership branch + project_id resolvers (ADR-037 c)"
```

---

### Task 4: `membership_repo.py` — invite / revoke / list / redeem-on-login

**Files:**
- Create: `backend/src/trust/membership_repo.py`
- Create: `backend/tests/test_trust_membership_repo.py`
- Create: `backend/tests/test_trust_redeem.py`

**Interfaces:**
- Consumes: `models` (Task 2), `project_membership`/`project_invitation` tables.
- Produces:
  - `invite(conn, *, project_id, email, invited_by_sub, role="reviewer") -> Invitation`
  - `revoke(conn, *, project_id, email) -> None`
  - `list_invitations(conn, *, project_id) -> list[Invitation]`
  - `list_members(conn, *, project_id) -> list[Membership]`
  - `redeem_invitations_for(conn, *, account_id, email) -> list[Membership]`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_trust_membership_repo.py`:

```python
import os, uuid
import asyncpg
import pytest
from src.trust import project_repo, membership_repo

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
    a = await conn.fetchval("INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}")
    return await project_repo.create_project(conn, owner_account_id=a, title="T")

async def test_invite_lowercases_and_reactivates(conn):
    p = await _project(conn)
    inv = await membership_repo.invite(conn, project_id=p.id, email="Expert@Firm.COM", invited_by_sub="op")
    assert inv.invited_email == "expert@firm.com" and inv.role == "reviewer" and inv.revoked_at is None
    await membership_repo.revoke(conn, project_id=p.id, email="expert@firm.com")
    assert (await membership_repo.list_invitations(conn, project_id=p.id))[0].revoked_at is not None
    # re-invite reactivates the same row (unique project_id+email)
    inv2 = await membership_repo.invite(conn, project_id=p.id, email="expert@firm.com", invited_by_sub="op2")
    assert inv2.revoked_at is None
    assert len(await membership_repo.list_invitations(conn, project_id=p.id)) == 1

async def test_invite_bad_role(conn):
    p = await _project(conn)
    with pytest.raises(ValueError):
        await membership_repo.invite(conn, project_id=p.id, email="x@y.z", invited_by_sub="op", role="owner")

async def test_list_members(conn):
    p = await _project(conn)
    acc = await conn.fetchval("INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}")
    await conn.execute("INSERT INTO project_membership (project_id, account_id, role) VALUES ($1,$2,'reviewer')", p.id, acc)
    members = await membership_repo.list_members(conn, project_id=p.id)
    assert [m.account_id for m in members] == [acc] and members[0].role == "reviewer"
```

`backend/tests/test_trust_redeem.py`:

```python
import os, uuid
import asyncpg
import pytest
from src.trust import project_repo, membership_repo

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

async def _account(conn, email=None):
    return await conn.fetchval(
        "INSERT INTO account (idp_sub, email) VALUES ($1,$2) RETURNING id",
        f"s-{uuid.uuid4()}", email,
    )

async def _project(conn):
    owner = await _account(conn)
    return await project_repo.create_project(conn, owner_account_id=owner, title="T")

async def test_redeem_creates_membership(conn):
    p = await _project(conn)
    await membership_repo.invite(conn, project_id=p.id, email="expert@firm.com", invited_by_sub="op")
    expert = await _account(conn, email="expert@firm.com")
    got = await membership_repo.redeem_invitations_for(conn, account_id=expert, email="Expert@Firm.com")
    assert [(m.project_id, m.role) for m in got] == [(p.id, "reviewer")]
    # idempotent on second login
    again = await membership_repo.redeem_invitations_for(conn, account_id=expert, email="expert@firm.com")
    assert [(m.project_id, m.role) for m in again] == [(p.id, "reviewer")]

async def test_redeem_skips_revoked_and_unrelated(conn):
    p = await _project(conn)
    await membership_repo.invite(conn, project_id=p.id, email="expert@firm.com", invited_by_sub="op")
    await membership_repo.revoke(conn, project_id=p.id, email="expert@firm.com")
    expert = await _account(conn)
    assert await membership_repo.redeem_invitations_for(conn, account_id=expert, email="expert@firm.com") == []
    assert await membership_repo.redeem_invitations_for(conn, account_id=expert, email="nobody@x.z") == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_membership_repo.py tests/test_trust_redeem.py -v`
Expected: FAIL — `ModuleNotFoundError: src.trust.membership_repo`.

- [ ] **Step 3: Write the repo**

```python
# backend/src/trust/membership_repo.py
from __future__ import annotations
import asyncpg
from .models import Invitation, Membership, INVITE_ROLES

_INV = "id, project_id, invited_email, role, invited_by_sub, created_at, revoked_at"
_MEM = "project_id, account_id, role, created_at"


def _invitation(r) -> Invitation:
    return Invitation(**{k: r[k] for k in
                         ("id", "project_id", "invited_email", "role",
                          "invited_by_sub", "created_at", "revoked_at")})


def _membership(r) -> Membership:
    return Membership(**{k: r[k] for k in
                         ("project_id", "account_id", "role", "created_at")})


async def invite(conn, *, project_id, email, invited_by_sub, role="reviewer") -> Invitation:
    if role not in INVITE_ROLES:
        raise ValueError(f"invalid invite role {role!r}")
    r = await conn.fetchrow(
        f"INSERT INTO project_invitation (project_id, invited_email, role, invited_by_sub) "
        f"VALUES ($1,$2,$3,$4) "
        f"ON CONFLICT (project_id, invited_email) DO UPDATE SET "
        f"revoked_at = NULL, invited_by_sub = EXCLUDED.invited_by_sub, role = EXCLUDED.role "
        f"RETURNING {_INV}",
        project_id, email.lower(), role, invited_by_sub,
    )
    return _invitation(r)


async def revoke(conn, *, project_id, email) -> None:
    await conn.execute(
        "UPDATE project_invitation SET revoked_at = now() "
        "WHERE project_id = $1 AND invited_email = $2",
        project_id, email.lower(),
    )


async def list_invitations(conn, *, project_id) -> list[Invitation]:
    rows = await conn.fetch(
        f"SELECT {_INV} FROM project_invitation WHERE project_id = $1 "
        f"ORDER BY created_at, id",
        project_id,
    )
    return [_invitation(r) for r in rows]


async def list_members(conn, *, project_id) -> list[Membership]:
    rows = await conn.fetch(
        f"SELECT {_MEM} FROM project_membership WHERE project_id = $1 "
        f"ORDER BY created_at, account_id",
        project_id,
    )
    return [_membership(r) for r in rows]


async def redeem_invitations_for(conn, *, account_id, email) -> list[Membership]:
    """Materialize memberships for every active invite matching this email.
    The login hook (wiring deferred — no trust router yet)."""
    invited = await conn.fetch(
        "SELECT project_id, role FROM project_invitation "
        "WHERE invited_email = $1 AND revoked_at IS NULL",
        email.lower(),
    )
    for row in invited:
        await conn.execute(
            "INSERT INTO project_membership (project_id, account_id, role) "
            "VALUES ($1,$2,$3) ON CONFLICT (project_id, account_id) DO NOTHING",
            row["project_id"], account_id, row["role"],
        )
    if not invited:
        return []
    project_ids = [row["project_id"] for row in invited]
    rows = await conn.fetch(
        f"SELECT {_MEM} FROM project_membership "
        f"WHERE account_id = $1 AND project_id = ANY($2::uuid[]) "
        f"ORDER BY created_at, project_id",
        account_id, project_ids,
    )
    return [_membership(r) for r in rows]
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_membership_repo.py tests/test_trust_redeem.py -v`
Expected: PASS (invite lowercase+reactivate, bad role→ValueError, list_members, redeem creates/idempotent, redeem skips revoked/unrelated).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/membership_repo.py tests/test_trust_membership_repo.py tests/test_trust_redeem.py && ruff format --check src/trust/membership_repo.py tests/test_trust_membership_repo.py tests/test_trust_redeem.py
git add backend/src/trust/membership_repo.py backend/tests/test_trust_membership_repo.py backend/tests/test_trust_redeem.py
git commit -m "feat(trust): membership repo — invite/revoke/list + redeem-on-login (ADR-037 c)"
```

---

### Task 5: `approval.recorded_via` — provenance param + dataclass field

**Files:**
- Modify: `backend/src/trust/models.py` (add field to `Approval`)
- Modify: `backend/src/trust/approval_repo.py`
- Modify: `backend/tests/test_trust_approval_repo.py`

**Interfaces:**
- Consumes: `APPROVAL_VIA` (Task 2), the `approval.recorded_via` column (Task 1).
- Produces: `record_approval(..., recorded_via="operator")` (validated against `APPROVAL_VIA`); `Approval.recorded_via` field; `get_approval` returns it.

- [ ] **Step 1: Add failing test cases**

Append to `backend/tests/test_trust_approval_repo.py` (has `conn`, `_version` helpers from (b)):

```python
async def test_recorded_via_default_and_expert_self(conn):
    v = await _version(conn)
    a1 = await approval_repo.record_approval(
        conn, version_id=v.id, expert_name="Dr X",
        approved_at=datetime.now(timezone.utc), recorded_by_sub="op",
    )
    assert a1.recorded_via == "operator"
    v2 = await _version(conn)
    a2 = await approval_repo.record_approval(
        conn, version_id=v2.id, expert_name="Dr Y",
        approved_at=datetime.now(timezone.utc), recorded_by_sub="expert-sub",
        recorded_via="expert_self",
    )
    assert a2.recorded_via == "expert_self"
    assert (await approval_repo.get_approval(conn, version_id=v2.id)).recorded_via == "expert_self"

async def test_recorded_via_invalid(conn):
    v = await _version(conn)
    with pytest.raises(ValueError):
        await approval_repo.record_approval(
            conn, version_id=v.id, expert_name="Z",
            approved_at=datetime.now(timezone.utc), recorded_by_sub="op",
            recorded_via="bogus",
        )
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_approval_repo.py -k recorded_via -v`
Expected: FAIL — `record_approval` has no `recorded_via` param / `Approval` has no `recorded_via`.

- [ ] **Step 3a: Add the field to `Approval` in `models.py`**

Add `recorded_via: str` to the `Approval` dataclass (place it after `note`):

```python
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
    recorded_via: str
```

- [ ] **Step 3b: Update `approval_repo.py`**

Import `APPROVAL_VIA`; add `recorded_via` to the column list, the mapper, and `record_approval`:

```python
from .models import Approval, APPROVAL_VIA

_AP = ("id, version_id, expert_name, expert_email, expert_role, "
       "approved_at, recorded_by_sub, recorded_at, note, recorded_via")


def _approval(r) -> Approval:
    return Approval(**{k: r[k] for k in
                       ("id", "version_id", "expert_name", "expert_email",
                        "expert_role", "approved_at", "recorded_by_sub",
                        "recorded_at", "note", "recorded_via")})


async def record_approval(conn, *, version_id, expert_name, approved_at,
                          recorded_by_sub, expert_email=None, expert_role=None,
                          note=None, recorded_via="operator") -> Approval:
    if recorded_via not in APPROVAL_VIA:
        raise ValueError(f"invalid recorded_via {recorded_via!r}")
    r = await conn.fetchrow(
        f"INSERT INTO approval (version_id, expert_name, expert_email, expert_role, "
        f"approved_at, recorded_by_sub, note, recorded_via) "
        f"VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING {_AP}",
        version_id, expert_name, expert_email, expert_role,
        approved_at, recorded_by_sub, note, recorded_via,
    )
    return _approval(r)
```

Leave `get_approval` and `is_validated` otherwise unchanged (they use `_AP`/`_approval`, which now include `recorded_via`). **Do not add any update/delete.**

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_approval_repo.py -v`
Expected: PASS — old approval tests still green, `recorded_via` defaults to `operator`, `expert_self` stored + read, invalid→`ValueError`.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/approval_repo.py src/trust/models.py tests/test_trust_approval_repo.py && ruff format --check src/trust/approval_repo.py src/trust/models.py tests/test_trust_approval_repo.py
git add backend/src/trust/approval_repo.py backend/src/trust/models.py backend/tests/test_trust_approval_repo.py
git commit -m "feat(trust): approval.recorded_via provenance (operator|expert_self) (ADR-037 c)"
```

---

## Final verification

- [ ] Whole trust suite: `cd backend && DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_*.py -v` — all pass (or cleanly skip without `DATABASE_URL`).
- [ ] Lint: `cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust tests/test_trust_*.py && ruff format --check src/trust tests/test_trust_*.py` — clean.
- [ ] `require_project_access` remains the single authorization point (owner + membership), still app-level (no RLS introduced).
- [ ] `approval` remains append-only (no update/delete added); `recorded_via` default `operator` preserves every (b) caller/test.
