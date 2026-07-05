# Draft Sharing (ADR-027 D2–D4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registered author shares a hosted draft by email; invited registered recipients see it under "Shared with you", read it, and leave version-scoped comments, each with an optional owner-only author response.

**Architecture:** New isolated `backend/src/sharing/` module (repo + schemas + router) over three Postgres tables (one alembic migration), mirroring the existing `library`/`accounts` pattern; authz matches the verified `Principal.email` to active invitations. Mobile adds API-client methods, a `ShareDraftModal` (author) + `SharedWithYou` section (recipient) + a shared `DraftCommentThread`.

**Tech Stack:** FastAPI · asyncpg · alembic · pytest; React Native + Expo · TypeScript · Jest + @testing-library/react-native.

## Global Constraints

- **All secrets from env; no hardcoded defaults** (`pydantic-settings`). Never log `book_json` or comment bodies — `structlog` at info logs ids only (backend rule 1; the mandatory no-key-in-logs test extends to bodies).
- **`asyncpg` for Postgres, `httpx.AsyncClient` for outbound** — never block the event loop (backend rule 6).
- **Auth:** every endpoint `Depends(require_user)` → `Principal` (`sub`, `email: str | None`). Recipient authz matches **lowercased** `principal.email` to an active (`revoked_at IS NULL`) invitation; a null email matches nothing.
- **Ownership is first-share-wins** (mirror `published_repo.claim_or_check_owner`).
- **Comments are version-scoped** (ADR-027 D4): a comment attaches to the draft `version` string; a new version does not surface old-version comments.
- **`author_response` is owner-only** (set/edit/clear via the response endpoint); empty/whitespace clears it (→ NULL).
- **Rate-limit writes:** `Depends(enforce_rate_limit)` on share / add-invitation / post-comment / set-response (as `library.router.publish_book` does).
- **Repo tests** hit real Postgres, gated by `DATABASE_URL` (`skipif`), each in a rolled-back transaction. **Router tests** use the faked-conn + `app.dependency_overrides` pattern from `backend/tests/test_library.py`.
- Backend commands run from `backend/`. Mobile from `mobile/`. Tests: `pytest tests/<f>.py` / `npx jest <path>`; typecheck `npm run typecheck`; lint `npm run lint`.

---

### Task 1: Migration + `shared_draft` repo (store + ownership)

**Files:**
- Create: `backend/alembic/versions/0008_draft_sharing.py`
- Create: `backend/src/sharing/__init__.py` (empty), `backend/src/sharing/repo.py`
- Test: `backend/tests/test_sharing_repo.py`

**Interfaces:**
- Produces:
  ```python
  @dataclass
  class SharedDraft:
      book_id: str; owner_sub: str; version: str; title: str
      book_json: dict; created_at: datetime; updated_at: datetime
  async def claim_or_share(conn, *, book_id: str, sub: str) -> bool   # first-share-wins; True iff sub owns
  async def upsert_draft(conn, *, book_id, owner_sub, version, title, book_json) -> None
  async def get_draft(conn, *, book_id: str) -> SharedDraft | None
  ```

- [ ] **Step 1: Write the migration**

Create `backend/alembic/versions/0008_draft_sharing.py` (check the latest `down_revision` by reading the newest file in `backend/alembic/versions/`; it is `0007_published_artifact` → its `revision` string):

```python
"""draft sharing: shared_draft + draft_invitation + draft_comment (ADR-027 D2-D4)"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008_draft_sharing"
down_revision = "0007_published_artifact"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_draft",
        sa.Column("book_id", sa.Text(), primary_key=True),
        sa.Column("owner_sub", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("book_json", JSONB(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_table(
        "draft_invitation",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("book_id", sa.Text(), sa.ForeignKey("shared_draft.book_id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_email", sa.Text(), nullable=False),
        sa.Column("invited_by_sub", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("book_id", "invited_email", name="uq_draft_invitation_book_email"),
    )
    op.create_table(
        "draft_comment",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("book_id", sa.Text(), sa.ForeignKey("shared_draft.book_id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("author_sub", sa.Text(), nullable=False),
        sa.Column("author_email", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_response", sa.Text(), nullable=True),
        sa.Column("responded_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_draft_comment_book_version", "draft_comment", ["book_id", "version", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_draft_comment_book_version", table_name="draft_comment")
    op.drop_table("draft_comment")
    op.drop_table("draft_invitation")
    op.drop_table("shared_draft")
```

- [ ] **Step 2: Write the failing repo test**

Create `backend/tests/test_sharing_repo.py`:

```python
"""sharing repo against a real Postgres; per-test transaction rollback.
Skipped when DATABASE_URL is unset (local / non-DB CI jobs)."""
from __future__ import annotations

import os
import asyncpg
import pytest
from backend.src.sharing import repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")]


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


async def test_claim_or_share_first_wins(conn):
    assert await repo.claim_or_share(conn, book_id="b1", sub="author-1") is True
    # same owner re-claims fine
    assert await repo.claim_or_share(conn, book_id="b1", sub="author-1") is True
    # a different sub cannot claim an owned draft
    assert await repo.claim_or_share(conn, book_id="b1", sub="other") is False


async def test_upsert_and_get_draft(conn):
    await repo.claim_or_share(conn, book_id="b2", sub="author-1")
    await repo.upsert_draft(conn, book_id="b2", owner_sub="author-1", version="1.0", title="T", book_json={"id": "b2"})
    d = await repo.get_draft(conn, book_id="b2")
    assert d is not None and d.owner_sub == "author-1" and d.version == "1.0"
    assert d.title == "T" and d.book_json == {"id": "b2"}
    # re-share (new version) replaces content
    await repo.upsert_draft(conn, book_id="b2", owner_sub="author-1", version="1.1", title="T2", book_json={"id": "b2", "v": 2})
    d2 = await repo.get_draft(conn, book_id="b2")
    assert d2.version == "1.1" and d2.title == "T2" and d2.book_json["v"] == 2


async def test_get_missing_draft_is_none(conn):
    assert await repo.get_draft(conn, book_id="nope") is None
```

- [ ] **Step 3: Run to verify it fails**

Run (from `backend/`, with a test DB): `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mentible_test pytest tests/test_sharing_repo.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.src.sharing` (or import error). (If no local DB, the tests **skip** — that is the RED-equivalent; CI runs them for real.)

- [ ] **Step 4: Implement `shared_draft` repo**

Create `backend/src/sharing/__init__.py` (empty) and `backend/src/sharing/repo.py`:

```python
"""Registry access for hosted draft sharing (ADR-027 D2-D4): shared_draft,
draft_invitation, draft_comment. Mirrors library/published_repo."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

import asyncpg


@dataclass
class SharedDraft:
    book_id: str
    owner_sub: str
    version: str
    title: str
    book_json: dict
    created_at: datetime
    updated_at: datetime


def _draft(r: asyncpg.Record) -> SharedDraft:
    bj = r["book_json"]
    return SharedDraft(
        book_id=r["book_id"],
        owner_sub=r["owner_sub"],
        version=r["version"],
        title=r["title"],
        book_json=json.loads(bj) if isinstance(bj, str) else bj,
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


async def claim_or_share(conn: asyncpg.Connection, *, book_id: str, sub: str) -> bool:
    """First-share-wins ownership. Inserts a placeholder row for `book_id` owned by
    `sub` if unowned, then returns True iff `sub` owns it. A different sub → False
    (caller refuses). Atomic under the row's ON CONFLICT DO NOTHING + re-read."""
    await conn.execute(
        """
        INSERT INTO shared_draft (book_id, owner_sub, version, title, book_json)
        VALUES ($1, $2, '', '', '{}'::jsonb)
        ON CONFLICT (book_id) DO NOTHING
        """,
        book_id,
        sub,
    )
    owner = await conn.fetchval("SELECT owner_sub FROM shared_draft WHERE book_id = $1", book_id)
    return owner == sub


async def upsert_draft(
    conn: asyncpg.Connection, *, book_id: str, owner_sub: str, version: str, title: str, book_json: dict
) -> None:
    """Store/replace the draft content for an owned book (call after claim_or_share)."""
    await conn.execute(
        """
        INSERT INTO shared_draft (book_id, owner_sub, version, title, book_json, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, now())
        ON CONFLICT (book_id) DO UPDATE SET
            version    = EXCLUDED.version,
            title      = EXCLUDED.title,
            book_json  = EXCLUDED.book_json,
            updated_at = now()
        """,
        book_id,
        owner_sub,
        version,
        title,
        json.dumps(book_json),
    )


async def get_draft(conn: asyncpg.Connection, *, book_id: str) -> SharedDraft | None:
    r = await conn.fetchrow("SELECT * FROM shared_draft WHERE book_id = $1", book_id)
    return _draft(r) if r else None
```

- [ ] **Step 5: Run to verify pass**

Run: `DATABASE_URL=… pytest tests/test_sharing_repo.py -q` (needs the DB migrated: `alembic upgrade head`).
Expected: PASS (3 tests) — or SKIP without a DB (CI runs them).

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/0008_draft_sharing.py backend/src/sharing/ backend/tests/test_sharing_repo.py
git commit -m "feat(sharing): draft-sharing migration + shared_draft repo"
```

---

### Task 2: Invitations + `draft_access` + shared-with-me (repo)

**Files:**
- Modify: `backend/src/sharing/repo.py`
- Test: `backend/tests/test_sharing_repo.py` (append)

**Interfaces:**
- Consumes: `claim_or_share`, `upsert_draft` (Task 1).
- Produces:
  ```python
  @dataclass
  class Invitation:
      invited_email: str; invited_by_sub: str; created_at: datetime; revoked_at: datetime | None
  async def add_invitation(conn, *, book_id, email, invited_by_sub) -> None   # upsert; reactivates a revoked one
  async def list_invitations(conn, *, book_id) -> list[Invitation]
  async def revoke_invitation(conn, *, book_id, email) -> bool                # True if a row was revoked
  async def draft_access(conn, *, book_id, sub, email) -> str | None          # "owner" | "invited" | None
  @dataclass
  class SharedWithMe:
      book_id: str; title: str; owner_sub: str; version: str; updated_at: datetime
  async def shared_with_me(conn, *, email) -> list[SharedWithMe]
  ```

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_sharing_repo.py`)

```python
async def _seed(conn, book_id="b1", owner="author-1"):
    await repo.claim_or_share(conn, book_id=book_id, sub=owner)
    await repo.upsert_draft(conn, book_id=book_id, owner_sub=owner, version="1.0", title="T", book_json={"id": book_id})


async def test_invitations_add_list_revoke(conn):
    await _seed(conn)
    await repo.add_invitation(conn, book_id="b1", email="Alice@x.com", invited_by_sub="author-1")
    inv = await repo.list_invitations(conn, book_id="b1")
    assert len(inv) == 1 and inv[0].invited_email == "alice@x.com" and inv[0].revoked_at is None
    assert await repo.revoke_invitation(conn, book_id="b1", email="alice@x.com") is True
    assert (await repo.list_invitations(conn, book_id="b1"))[0].revoked_at is not None
    # re-invite reactivates the same row
    await repo.add_invitation(conn, book_id="b1", email="alice@x.com", invited_by_sub="author-1")
    assert (await repo.list_invitations(conn, book_id="b1"))[0].revoked_at is None


async def test_draft_access(conn):
    await _seed(conn)
    await repo.add_invitation(conn, book_id="b1", email="alice@x.com", invited_by_sub="author-1")
    assert await repo.draft_access(conn, book_id="b1", sub="author-1", email="author@x.com") == "owner"
    assert await repo.draft_access(conn, book_id="b1", sub="s2", email="ALICE@x.com") == "invited"
    assert await repo.draft_access(conn, book_id="b1", sub="s3", email="bob@x.com") is None
    assert await repo.draft_access(conn, book_id="b1", sub="s4", email=None) is None
    await repo.revoke_invitation(conn, book_id="b1", email="alice@x.com")
    assert await repo.draft_access(conn, book_id="b1", sub="s2", email="alice@x.com") is None


async def test_shared_with_me(conn):
    await _seed(conn, book_id="b1")
    await _seed(conn, book_id="b2")
    await repo.add_invitation(conn, book_id="b1", email="alice@x.com", invited_by_sub="author-1")
    await repo.add_invitation(conn, book_id="b2", email="alice@x.com", invited_by_sub="author-1")
    await repo.revoke_invitation(conn, book_id="b2", email="alice@x.com")
    mine = await repo.shared_with_me(conn, email="alice@x.com")
    assert [m.book_id for m in mine] == ["b1"]  # revoked b2 excluded
    assert await repo.shared_with_me(conn, email=None) == []
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=… pytest tests/test_sharing_repo.py -q -k "invitations or draft_access or shared_with_me"`
Expected: FAIL — `AttributeError: module … has no attribute 'add_invitation'`.

- [ ] **Step 3: Implement** (append to `backend/src/sharing/repo.py`)

```python
@dataclass
class Invitation:
    invited_email: str
    invited_by_sub: str
    created_at: datetime
    revoked_at: datetime | None


async def add_invitation(conn: asyncpg.Connection, *, book_id: str, email: str, invited_by_sub: str) -> None:
    """Invite (or re-invite) an email. Re-inviting a revoked row reactivates it."""
    await conn.execute(
        """
        INSERT INTO draft_invitation (book_id, invited_email, invited_by_sub)
        VALUES ($1, $2, $3)
        ON CONFLICT (book_id, invited_email) DO UPDATE SET
            revoked_at = NULL, invited_by_sub = EXCLUDED.invited_by_sub
        """,
        book_id,
        email.lower(),
        invited_by_sub,
    )


async def list_invitations(conn: asyncpg.Connection, *, book_id: str) -> list[Invitation]:
    rows = await conn.fetch(
        "SELECT invited_email, invited_by_sub, created_at, revoked_at "
        "FROM draft_invitation WHERE book_id = $1 ORDER BY created_at",
        book_id,
    )
    return [Invitation(r["invited_email"], r["invited_by_sub"], r["created_at"], r["revoked_at"]) for r in rows]


async def revoke_invitation(conn: asyncpg.Connection, *, book_id: str, email: str) -> bool:
    row = await conn.fetchrow(
        "UPDATE draft_invitation SET revoked_at = now() "
        "WHERE book_id = $1 AND invited_email = $2 AND revoked_at IS NULL RETURNING id",
        book_id,
        email.lower(),
    )
    return row is not None


async def draft_access(conn: asyncpg.Connection, *, book_id: str, sub: str, email: str | None) -> str | None:
    """'owner' if sub owns the draft; else 'invited' if email has an active invite; else None."""
    owner = await conn.fetchval("SELECT owner_sub FROM shared_draft WHERE book_id = $1", book_id)
    if owner is None:
        return None
    if owner == sub:
        return "owner"
    if not email:
        return None
    invited = await conn.fetchval(
        "SELECT 1 FROM draft_invitation "
        "WHERE book_id = $1 AND invited_email = $2 AND revoked_at IS NULL",
        book_id,
        email.lower(),
    )
    return "invited" if invited else None


@dataclass
class SharedWithMe:
    book_id: str
    title: str
    owner_sub: str
    version: str
    updated_at: datetime


async def shared_with_me(conn: asyncpg.Connection, *, email: str | None) -> list[SharedWithMe]:
    if not email:
        return []
    rows = await conn.fetch(
        """
        SELECT d.book_id, d.title, d.owner_sub, d.version, d.updated_at
        FROM shared_draft d
        JOIN draft_invitation i ON i.book_id = d.book_id
        WHERE i.invited_email = $1 AND i.revoked_at IS NULL
        ORDER BY d.updated_at DESC
        """,
        email.lower(),
    )
    return [SharedWithMe(r["book_id"], r["title"], r["owner_sub"], r["version"], r["updated_at"]) for r in rows]
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=… pytest tests/test_sharing_repo.py -q`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/src/sharing/repo.py backend/tests/test_sharing_repo.py
git commit -m "feat(sharing): invitations, draft_access, shared-with-me repo"
```

---

### Task 3: Comments + owner author-response (repo)

**Files:**
- Modify: `backend/src/sharing/repo.py`
- Test: `backend/tests/test_sharing_repo.py` (append)

**Interfaces:**
- Produces:
  ```python
  @dataclass
  class Comment:
      id: int; version: str; author_sub: str; author_email: str | None
      body: str; author_response: str | None; responded_at: datetime | None; created_at: datetime
  async def add_comment(conn, *, book_id, version, author_sub, author_email, body) -> Comment
  async def list_comments(conn, *, book_id, version) -> list[Comment]
  async def set_response(conn, *, book_id, comment_id, response) -> Comment | None  # None if comment not on book; empty response clears
  ```

- [ ] **Step 1: Write failing tests** (append)

```python
async def test_comments_version_scoped(conn):
    await _seed(conn)
    c = await repo.add_comment(conn, book_id="b1", version="1.0", author_sub="s2", author_email="a@x.com", body="fix ch2")
    assert c.body == "fix ch2" and c.author_response is None and c.version == "1.0"
    await repo.add_comment(conn, book_id="b1", version="1.1", author_sub="s2", author_email="a@x.com", body="on v1.1")
    v10 = await repo.list_comments(conn, book_id="b1", version="1.0")
    assert [x.body for x in v10] == ["fix ch2"]  # v1.1 comment not surfaced


async def test_set_and_clear_response(conn):
    await _seed(conn)
    c = await repo.add_comment(conn, book_id="b1", version="1.0", author_sub="s2", author_email="a@x.com", body="q")
    updated = await repo.set_response(conn, book_id="b1", comment_id=c.id, response="answered")
    assert updated is not None and updated.author_response == "answered" and updated.responded_at is not None
    cleared = await repo.set_response(conn, book_id="b1", comment_id=c.id, response="   ")
    assert cleared.author_response is None and cleared.responded_at is None
    # a comment id not on this book → None
    assert await repo.set_response(conn, book_id="other", comment_id=c.id, response="x") is None
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=… pytest tests/test_sharing_repo.py -q -k "comments or response"`
Expected: FAIL — `add_comment` missing.

- [ ] **Step 3: Implement** (append to `backend/src/sharing/repo.py`)

```python
@dataclass
class Comment:
    id: int
    version: str
    author_sub: str
    author_email: str | None
    body: str
    author_response: str | None
    responded_at: datetime | None
    created_at: datetime


def _comment(r: asyncpg.Record) -> Comment:
    return Comment(
        id=r["id"], version=r["version"], author_sub=r["author_sub"], author_email=r["author_email"],
        body=r["body"], author_response=r["author_response"], responded_at=r["responded_at"], created_at=r["created_at"],
    )


async def add_comment(
    conn: asyncpg.Connection, *, book_id: str, version: str, author_sub: str, author_email: str | None, body: str
) -> Comment:
    r = await conn.fetchrow(
        """
        INSERT INTO draft_comment (book_id, version, author_sub, author_email, body)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
        """,
        book_id, version, author_sub, author_email, body,
    )
    return _comment(r)


async def list_comments(conn: asyncpg.Connection, *, book_id: str, version: str) -> list[Comment]:
    rows = await conn.fetch(
        "SELECT * FROM draft_comment WHERE book_id = $1 AND version = $2 ORDER BY created_at",
        book_id, version,
    )
    return [_comment(r) for r in rows]


async def set_response(conn: asyncpg.Connection, *, book_id: str, comment_id: int, response: str) -> Comment | None:
    """Owner-only author response. Empty/whitespace clears it. None if the comment
    isn't on this book (authz that the caller is the owner happens in the router)."""
    clean = response.strip()
    r = await conn.fetchrow(
        """
        UPDATE draft_comment
        SET author_response = $3, responded_at = CASE WHEN $3 IS NULL THEN NULL ELSE now() END
        WHERE id = $1 AND book_id = $2 RETURNING *
        """,
        comment_id, book_id, (clean or None),
    )
    return _comment(r) if r else None
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=… pytest tests/test_sharing_repo.py -q`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/src/sharing/repo.py backend/tests/test_sharing_repo.py
git commit -m "feat(sharing): version-scoped comments + owner author-response repo"
```

---

### Task 4: Schemas + router + wire into the app

**Files:**
- Create: `backend/src/sharing/schemas.py`, `backend/src/sharing/router.py`
- Modify: `backend/main.py` (add `app.include_router`)
- Test: `backend/tests/test_sharing_api.py`

**Interfaces:**
- Consumes: all of `sharing/repo.py`; `require_user` → `Principal`; `enforce_rate_limit`.
- Produces: HTTP endpoints under `/api/v1/drafts` (see spec table).

- [ ] **Step 1: Write the failing router tests**

Create `backend/tests/test_sharing_api.py` (faked-conn pattern from `test_library.py`; the fake returns canned `draft_access`/rows so we test HTTP wiring + authz mapping, not SQL):

```python
"""Draft-sharing HTTP wiring: auth, status codes, owner-vs-invited authz. DB faked."""
from __future__ import annotations

import pytest
from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


class _Conn:
    def __init__(self, access="owner", owner="author-1"):
        self._access = access
        self._owner = owner
        self.executed = []

    async def execute(self, sql, *a):
        self.executed.append((sql, a))

    async def fetchval(self, sql, *a):
        if "owner_sub FROM shared_draft" in sql:
            return self._owner
        if "FROM draft_invitation" in sql:
            return 1 if self._access == "invited" else None
        return None

    async def fetchrow(self, sql, *a):
        return None

    async def fetch(self, sql, *a):
        return []


class _Pool:
    def __init__(self, conn):
        self._c = conn

    def acquire(self):
        c = self._c

        class _Cm:
            async def __aenter__(self):
                return c

            async def __aexit__(self, *a):
                return False

        return _Cm()


@pytest.fixture
def as_user():
    def _set(sub="author-1", email="author@x.com", conn=None):
        app.dependency_overrides[require_user] = lambda: Principal(sub=sub, email=email, issuer="test")
        app.state.db = _Pool(conn or _Conn())
    yield _set
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_share_requires_auth(as_user):
    from httpx import ASGITransport, AsyncClient
    app.state.db = _Pool(_Conn())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/share", json={"title": "T", "version": "1.0", "book_json": {"id": "b1"}})
    assert r.status_code == 401  # no override → require_user rejects


@pytest.mark.asyncio
async def test_add_invitation_owner_ok(as_user):
    from httpx import ASGITransport, AsyncClient
    as_user(sub="author-1", conn=_Conn(owner="author-1"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/invitations", json={"email": "Alice@x.com"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_add_invitation_non_owner_403(as_user):
    from httpx import ASGITransport, AsyncClient
    as_user(sub="intruder", conn=_Conn(owner="author-1"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/invitations", json={"email": "a@x.com"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_comment_empty_body_422(as_user):
    from httpx import ASGITransport, AsyncClient
    as_user(sub="author-1", conn=_Conn(owner="author-1", access="owner"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/drafts/b1/comments", json={"version": "1.0", "body": "   "})
    assert r.status_code == 422
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_sharing_api.py -q`
Expected: FAIL — 404 for the routes (router not mounted) / import error.

- [ ] **Step 3: Implement schemas**

Create `backend/src/sharing/schemas.py`:

```python
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, field_validator


class ShareIn(BaseModel):
    title: str
    version: str
    book_json: dict


class InviteIn(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _email_shape(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1] or len(v) < 5:
            raise ValueError("invalid email")
        return v


class CommentIn(BaseModel):
    version: str
    body: str

    @field_validator("body")
    @classmethod
    def _nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("empty comment")
        return v


class ResponseIn(BaseModel):
    response: str  # empty/whitespace clears


class CommentOut(BaseModel):
    id: int
    version: str
    author_sub: str
    author_email: str | None
    body: str
    author_response: str | None
    responded_at: datetime | None
    created_at: datetime


class DraftOut(BaseModel):
    book_id: str
    title: str
    version: str
    book_json: dict
    access: str


class SharedItem(BaseModel):
    book_id: str
    title: str
    owner_sub: str
    version: str
    updated_at: datetime


class InvitationOut(BaseModel):
    invited_email: str
    invited_by_sub: str
    created_at: datetime
    revoked_at: datetime | None
```

- [ ] **Step 4: Implement the router**

Create `backend/src/sharing/router.py`:

```python
"""Draft-sharing HTTP surface (ADR-027 D2-D4). All endpoints require a user."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status

from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.sharing import repo
from backend.src.sharing.schemas import (
    CommentIn, CommentOut, DraftOut, InvitationOut, InviteIn, ResponseIn, ShareIn, SharedItem,
)

router = APIRouter(prefix="/api/v1/drafts", tags=["drafts"])


def _pool(request: Request):
    pool = getattr(request.app.state, "db", None)
    if pool is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "draft sharing is not available")
    return pool


async def _require_owner(conn, book_id: str, p: Principal) -> None:
    if await repo.draft_access(conn, book_id=book_id, sub=p.sub, email=p.email) != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the draft owner")


async def _require_access(conn, book_id: str, p: Principal) -> str:
    access = await repo.draft_access(conn, book_id=book_id, sub=p.sub, email=p.email)
    if access is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this draft")
    return access


@router.post("/{book_id}/share", response_model=DraftOut, dependencies=[Depends(enforce_rate_limit)])
async def share_draft(book_id: str, body: ShareIn, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        if not await repo.claim_or_share(conn, book_id=book_id, sub=p.sub):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "this draft is owned by another author")
        await repo.upsert_draft(
            conn, book_id=book_id, owner_sub=p.sub, version=body.version, title=body.title, book_json=body.book_json
        )
    return DraftOut(book_id=book_id, title=body.title, version=body.version, book_json=body.book_json, access="owner")


@router.get("/shared-with-me", response_model=list[SharedItem])
async def shared_with_me(request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        items = await repo.shared_with_me(conn, email=p.email)
    return [SharedItem(**vars(i)) for i in items]


@router.get("/{book_id}", response_model=DraftOut)
async def get_draft(book_id: str, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        access = await _require_access(conn, book_id, p)
        d = await repo.get_draft(conn, book_id=book_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "draft not found")
    return DraftOut(book_id=d.book_id, title=d.title, version=d.version, book_json=d.book_json, access=access)


@router.get("/{book_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(book_id: str, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        inv = await repo.list_invitations(conn, book_id=book_id)
    return [InvitationOut(**vars(i)) for i in inv]


@router.post("/{book_id}/invitations", dependencies=[Depends(enforce_rate_limit)])
async def add_invitation(book_id: str, body: InviteIn, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        await repo.add_invitation(conn, book_id=book_id, email=body.email, invited_by_sub=p.sub)
    return {"ok": True}


@router.delete("/{book_id}/invitations")
async def revoke_invitation(book_id: str, request: Request, email: str = Body(..., embed=True), p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        if not await repo.revoke_invitation(conn, book_id=book_id, email=email):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no active invitation for that email")
    return {"ok": True}


@router.get("/{book_id}/comments", response_model=list[CommentOut])
async def list_comments(book_id: str, version: str, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_access(conn, book_id, p)
        rows = await repo.list_comments(conn, book_id=book_id, version=version)
    return [CommentOut(**vars(r)) for r in rows]


@router.post("/{book_id}/comments", response_model=CommentOut, dependencies=[Depends(enforce_rate_limit)])
async def post_comment(book_id: str, body: CommentIn, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_access(conn, book_id, p)
        c = await repo.add_comment(
            conn, book_id=book_id, version=body.version, author_sub=p.sub, author_email=p.email, body=body.body
        )
    return CommentOut(**vars(c))


@router.put("/{book_id}/comments/{comment_id}/response", response_model=CommentOut, dependencies=[Depends(enforce_rate_limit)])
async def set_response(book_id: str, comment_id: int, body: ResponseIn, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        c = await repo.set_response(conn, book_id=book_id, comment_id=comment_id, response=body.response)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found on this draft")
    return CommentOut(**vars(c))
```

- [ ] **Step 5: Mount the router**

In `backend/main.py`, next to the other `from backend.src.X import router as X_router` imports add:
```python
from backend.src.sharing import router as sharing_router
```
and next to the other `app.include_router(...)` lines add:
```python
app.include_router(sharing_router.router)
```

- [ ] **Step 6: Run to verify pass + full backend suite**

Run: `pytest tests/test_sharing_api.py -q` → PASS (4).
Run: `pytest -q` (full suite; with `DATABASE_URL` set, the repo tests run too) → all green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/sharing/schemas.py backend/src/sharing/router.py backend/main.py backend/tests/test_sharing_api.py
git commit -m "feat(sharing): draft-sharing API (share/invite/comment/response) + mount"
```

---

### Task 5: Mobile API client methods

**Files:**
- Modify: `mobile/src/api/client.ts`
- Test: `mobile/__tests__/api/draftSharing.test.ts`

**Interfaces:**
- Consumes: the `/api/v1/drafts` endpoints (Task 4); `BASE_URL`, the `Authorization: Bearer ${token}` pattern already in `client.ts` (see `publishBook`).
- Produces:
  ```ts
  export interface DraftComment { id: number; version: string; author_sub: string; author_email: string | null; body: string; author_response: string | null; responded_at: string | null; created_at: string }
  export interface SharedItem { book_id: string; title: string; owner_sub: string; version: string; updated_at: string }
  export interface DraftInvitation { invited_email: string; invited_by_sub: string; created_at: string; revoked_at: string | null }
  export async function shareDraft(book: Book, token: string): Promise<void>
  export async function listInvitations(bookId: string, token: string): Promise<DraftInvitation[]>
  export async function addInvitation(bookId: string, email: string, token: string): Promise<void>
  export async function revokeInvitation(bookId: string, email: string, token: string): Promise<void>
  export async function sharedWithMe(token: string): Promise<SharedItem[]>
  export async function getSharedDraft(bookId: string, token: string): Promise<{ book_json: unknown; title: string; version: string; access: string }>
  export async function listComments(bookId: string, version: string, token: string): Promise<DraftComment[]>
  export async function postComment(bookId: string, version: string, body: string, token: string): Promise<DraftComment>
  export async function setCommentResponse(bookId: string, commentId: number, response: string, token: string): Promise<DraftComment>
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/api/draftSharing.test.ts`:

```ts
import { addInvitation, postComment, sharedWithMe } from "@/api/client";

const okJson = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) } as Response);

describe("draft sharing client", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("addInvitation POSTs the email with a bearer token", async () => {
    fetchMock.mockReturnValue(okJson({ ok: true }));
    await addInvitation("b1", "Alice@x.com", "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/drafts\/b1\/invitations$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ email: "Alice@x.com" });
  });

  it("postComment returns the created comment", async () => {
    fetchMock.mockReturnValue(okJson({ id: 1, version: "1.0", body: "hi", author_response: null }));
    const c = await postComment("b1", "1.0", "hi", "tok");
    expect(c.id).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/drafts\/b1\/comments$/);
  });

  it("sharedWithMe GETs the list", async () => {
    fetchMock.mockReturnValue(okJson([{ book_id: "b1", title: "T" }]));
    const items = await sharedWithMe("tok");
    expect(items[0].book_id).toBe("b1");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/drafts\/shared-with-me$/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest __tests__/api/draftSharing.test.ts`
Expected: FAIL — the functions aren't exported.

- [ ] **Step 3: Implement** (append to `mobile/src/api/client.ts`, following the existing `publishBook` fetch style; reuse `BASE_URL`)

```ts
// ── Draft sharing (ADR-027 D2–D4) ─────────────────────────────────────────────
export interface DraftComment {
  id: number; version: string; author_sub: string; author_email: string | null;
  body: string; author_response: string | null; responded_at: string | null; created_at: string;
}
export interface SharedItem { book_id: string; title: string; owner_sub: string; version: string; updated_at: string }
export interface DraftInvitation { invited_email: string; invited_by_sub: string; created_at: string; revoked_at: string | null }

function authHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
async function draftFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}/api/v1/drafts${path}`, { ...init, headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Draft request failed (${res.status})`);
  return res;
}

export async function shareDraft(book: Book, token: string): Promise<void> {
  await draftFetch(`/${book.id}/share`, token, {
    method: "POST",
    body: JSON.stringify({ title: book.title, version: book.metadata?.version ?? "1.0", book_json: book }),
  });
}
export async function listInvitations(bookId: string, token: string): Promise<DraftInvitation[]> {
  return (await draftFetch(`/${bookId}/invitations`, token)).json();
}
export async function addInvitation(bookId: string, email: string, token: string): Promise<void> {
  await draftFetch(`/${bookId}/invitations`, token, { method: "POST", body: JSON.stringify({ email }) });
}
export async function revokeInvitation(bookId: string, email: string, token: string): Promise<void> {
  await draftFetch(`/${bookId}/invitations`, token, { method: "DELETE", body: JSON.stringify({ email }) });
}
export async function sharedWithMe(token: string): Promise<SharedItem[]> {
  return (await draftFetch(`/shared-with-me`, token)).json();
}
export async function getSharedDraft(bookId: string, token: string): Promise<{ book_json: unknown; title: string; version: string; access: string }> {
  return (await draftFetch(`/${bookId}`, token)).json();
}
export async function listComments(bookId: string, version: string, token: string): Promise<DraftComment[]> {
  return (await draftFetch(`/${bookId}/comments?version=${encodeURIComponent(version)}`, token)).json();
}
export async function postComment(bookId: string, version: string, body: string, token: string): Promise<DraftComment> {
  return (await draftFetch(`/${bookId}/comments`, token, { method: "POST", body: JSON.stringify({ version, body }) })).json();
}
export async function setCommentResponse(bookId: string, commentId: number, response: string, token: string): Promise<DraftComment> {
  return (await draftFetch(`/${bookId}/comments/${commentId}/response`, token, { method: "PUT", body: JSON.stringify({ response }) })).json();
}
```

(Ensure `Book` is imported in `client.ts` — it already imports book types for `publishBook`; if not, add `import type { Book } from "@/types/book";`.)

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx jest __tests__/api/draftSharing.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/client.ts mobile/__tests__/api/draftSharing.test.ts
git commit -m "feat(sharing): mobile API client for draft sharing"
```

---

### Task 6: `DraftCommentThread` component

**Files:**
- Create: `mobile/src/components/DraftCommentThread.tsx`
- Test: `mobile/__tests__/components/DraftCommentThread.test.tsx`

**Interfaces:**
- Consumes: `DraftComment` (Task 5); theme tokens.
- Produces:
  ```ts
  export function DraftCommentThread(props: {
    comments: DraftComment[];
    isOwner: boolean;
    onPost: (body: string) => void;              // add a comment
    onRespond?: (commentId: number, response: string) => void;  // owner only
  }): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/DraftCommentThread.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { DraftComment } from "@/api/client";

const c = (over: Partial<DraftComment> = {}): DraftComment => ({
  id: 1, version: "1.0", author_sub: "s", author_email: "a@x.com", body: "fix ch2",
  author_response: null, responded_at: null, created_at: "2026-07-05T00:00:00Z", ...over,
});

it("posts a new comment", () => {
  const onPost = jest.fn();
  render(<DraftCommentThread comments={[]} isOwner={false} onPost={onPost} />);
  fireEvent.changeText(screen.getByLabelText("Add a comment"), "looks good");
  fireEvent.press(screen.getByLabelText("Send comment"));
  expect(onPost).toHaveBeenCalledWith("looks good");
});

it("renders an author response beneath a comment", () => {
  render(<DraftCommentThread comments={[c({ author_response: "fixed in v1.1" })]} isOwner={false} onPost={jest.fn()} />);
  expect(screen.getByText("fix ch2")).toBeTruthy();
  expect(screen.getByText(/fixed in v1.1/)).toBeTruthy();
  expect(screen.queryByLabelText(/response to comment/i)).toBeNull(); // no owner affordance
});

it("owner sees a response affordance and fires onRespond", () => {
  const onRespond = jest.fn();
  render(<DraftCommentThread comments={[c()]} isOwner onPost={jest.fn()} onRespond={onRespond} />);
  fireEvent.changeText(screen.getByLabelText("Response to comment 1"), "done");
  fireEvent.press(screen.getByLabelText("Save response to comment 1"));
  expect(onRespond).toHaveBeenCalledWith(1, "done");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest __tests__/components/DraftCommentThread.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `mobile/src/components/DraftCommentThread.tsx`:

```tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { DraftComment } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

function CommentRow({ comment, isOwner, onRespond }: { comment: DraftComment; isOwner: boolean; onRespond?: (id: number, r: string) => void }) {
  const [resp, setResp] = useState(comment.author_response ?? "");
  return (
    <View style={styles.row}>
      <Text style={styles.author}>{comment.author_email ?? "Reviewer"}</Text>
      <Text style={styles.body}>{comment.body}</Text>
      {comment.author_response ? (
        <Text style={styles.response}>Author: {comment.author_response}</Text>
      ) : null}
      {isOwner && onRespond ? (
        <View style={styles.respondRow}>
          <TextInput
            value={resp}
            onChangeText={setResp}
            placeholder="Respond…"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={`Response to comment ${comment.id}`}
            style={styles.respondInput}
          />
          <Pressable
            onPress={() => onRespond(comment.id, resp)}
            accessibilityRole="button"
            accessibilityLabel={`Save response to comment ${comment.id}`}
            style={styles.respondBtn}
          >
            <Text style={styles.respondBtnText}>Save</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function DraftCommentThread({
  comments, isOwner, onPost, onRespond,
}: {
  comments: DraftComment[];
  isOwner: boolean;
  onPost: (body: string) => void;
  onRespond?: (commentId: number, response: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const clean = draft.trim();
    if (!clean) return;
    onPost(clean);
    setDraft("");
  };
  return (
    <View style={styles.thread}>
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} isOwner={isOwner} onRespond={onRespond} />
      ))}
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Add a comment"
          style={styles.input}
          multiline
        />
        <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Send comment" style={styles.sendBtn}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { gap: spacing.sm },
  row: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  author: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.textSecondary },
  body: { fontSize: typography.sizeSm, color: colors.text },
  response: { fontSize: typography.sizeSm, color: colors.growth, fontStyle: "italic", marginTop: 2 },
  respondRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  respondInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text, fontSize: typography.sizeXs },
  respondBtn: { backgroundColor: colors.surfaceHigh, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: spacing.sm },
  respondBtnText: { color: colors.text, fontWeight: "700", fontSize: typography.sizeXs },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: typography.sizeSm, minHeight: 40 },
  sendBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  sendText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/components/DraftCommentThread.test.tsx` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/DraftCommentThread.tsx mobile/__tests__/components/DraftCommentThread.test.tsx
git commit -m "feat(sharing): DraftCommentThread component"
```

---

### Task 7: Author `ShareDraftModal` + Share action

**Files:**
- Create: `mobile/src/components/ShareDraftModal.tsx`
- Modify: `mobile/app/book/saved/[id].tsx` (add a Share action that opens the modal)
- Test: `mobile/__tests__/components/ShareDraftModal.test.tsx`

**Interfaces:**
- Consumes: `shareDraft`, `listInvitations`, `addInvitation`, `revokeInvitation`, `listComments`, `postComment`, `setCommentResponse`, `DraftInvitation`, `DraftComment` (Task 5); `DraftCommentThread` (Task 6); the auth token (via the existing `useAuth`/Supabase session accessor used by `publishBook` callers).
- Produces: `export function ShareDraftModal(props: { visible: boolean; book: Book; token: string; onClose: () => void }): React.JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/ShareDraftModal.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ShareDraftModal } from "@/components/ShareDraftModal";
import type { Book } from "@/types/book";

jest.mock("@/api/client", () => ({
  shareDraft: jest.fn().mockResolvedValue(undefined),
  listInvitations: jest.fn().mockResolvedValue([]),
  addInvitation: jest.fn().mockResolvedValue(undefined),
  revokeInvitation: jest.fn().mockResolvedValue(undefined),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn().mockResolvedValue({ id: 1, version: "1.0", body: "x", author_response: null }),
  setCommentResponse: jest.fn().mockResolvedValue({}),
}));
import * as api from "@/api/client";

const book = { id: "b1", title: "T", toc: { subjects: [] }, createdAt: "", updatedAt: "", metadata: { version: "1.0" } } as unknown as Book;

it("shares the draft on open and adds an invitation", async () => {
  render(<ShareDraftModal visible book={book} token="tok" onClose={jest.fn()} />);
  await waitFor(() => expect(api.shareDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Invite by email"), "alice@x.com");
  fireEvent.press(screen.getByLabelText("Send invite"));
  await waitFor(() => expect(api.addInvitation).toHaveBeenCalledWith("b1", "alice@x.com", "tok"));
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest __tests__/components/ShareDraftModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `mobile/src/components/ShareDraftModal.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Alert } from "@/lib/alert";
import {
  addInvitation, listComments, listInvitations, postComment, revokeInvitation, setCommentResponse, shareDraft,
  type DraftComment, type DraftInvitation,
} from "@/api/client";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

export function ShareDraftModal({
  visible, book, token, onClose,
}: { visible: boolean; book: Book; token: string; onClose: () => void }): React.JSX.Element {
  const version = book.metadata?.version ?? "1.0";
  const [invites, setInvites] = useState<DraftInvitation[]>([]);
  const [comments, setComments] = useState<DraftComment[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInvites(await listInvitations(book.id, token));
      setComments(await listComments(book.id, version, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load sharing.");
    }
  }, [book.id, token, version]);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      try {
        await shareDraft(book, token); // upsert the current draft server-side
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't share the draft.");
      }
    })();
  }, [visible, book, token, refresh]);

  const active = invites.filter((i) => !i.revoked_at);

  const invite = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    setError(null);
    try {
      await addInvitation(book.id, clean, token);
      setEmail("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that email.");
    }
  };
  const revoke = (e: string) => {
    Alert.alert("Remove access?", `${e} will no longer see this draft.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void revokeInvitation(book.id, e, token).then(refresh).catch(() => {}) },
    ]);
  };
  const onPost = (body: string) => void postComment(book.id, version, body, token).then(refresh).catch(() => {});
  const onRespond = (id: number, r: string) => void setCommentResponse(book.id, id, r, token).then(refresh).catch(() => {});

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Share “{book.title}”</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.section}>Reviewers</Text>
            <View style={styles.inviteRow}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="name@email.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                accessibilityLabel="Invite by email"
                style={styles.input}
              />
              <Pressable onPress={invite} accessibilityRole="button" accessibilityLabel="Send invite" style={styles.inviteBtn}>
                <Text style={styles.inviteBtnText}>Invite</Text>
              </Pressable>
            </View>
            {active.map((i) => (
              <View key={i.invited_email} style={styles.inviteItem}>
                <Text style={styles.inviteEmail}>{i.invited_email}</Text>
                <Pressable onPress={() => revoke(i.invited_email)} accessibilityRole="button" accessibilityLabel={`Remove ${i.invited_email}`} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            <Text style={[styles.section, { marginTop: spacing.md }]}>Comments (v{version})</Text>
            <DraftCommentThread comments={comments} isOwner onPost={onPost} onRespond={onRespond} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text, flexShrink: 1 },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  content: { gap: spacing.xs, paddingBottom: spacing.lg },
  section: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.textSecondary },
  inviteRow: { flexDirection: "row", gap: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: typography.sizeSm },
  inviteBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, justifyContent: "center" },
  inviteBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
  inviteItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs },
  inviteEmail: { fontSize: typography.sizeSm, color: colors.text },
});
```

- [ ] **Step 4: Wire the Share action**

In `mobile/app/book/saved/[id].tsx`, near the existing **Publish** section, add a **Share** button that opens `ShareDraftModal` when the user is signed in (a token is available). Read the current sign-in/token accessor used by the Publish flow in that file and reuse it. Minimal wiring:
```tsx
// state
const [shareOpen, setShareOpen] = useState(false);
// in the Publish section, add:
<Pressable style={styles.publishBtn} onPress={() => setShareOpen(true)} accessibilityRole="button" accessibilityLabel="Share this draft">
  <Text style={styles.publishLabel}>Share draft</Text>
</Pressable>
// and, once `book` + `token` are known:
{book && token ? <ShareDraftModal visible={shareOpen} book={book} token={token} onClose={() => setShareOpen(false)} /> : null}
```
(Use the exact token accessor + button style already present in this screen; if there is no `token` variable, reuse the same Supabase-session getter the Publish button uses — grep `publishBook(` callers.)

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `npx jest __tests__/components/ShareDraftModal.test.tsx` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/ShareDraftModal.tsx mobile/app/book/saved/\[id\].tsx mobile/__tests__/components/ShareDraftModal.test.tsx
git commit -m "feat(sharing): author ShareDraftModal + Share action"
```

---

### Task 8: Recipient `SharedWithYou` section + read/comment

**Files:**
- Create: `mobile/src/components/SharedWithYou.tsx`
- Modify: `mobile/app/(tabs)/library.tsx` (mount the section)
- Test: `mobile/__tests__/components/SharedWithYou.test.tsx`

**Interfaces:**
- Consumes: `sharedWithMe`, `getSharedDraft`, `listComments`, `postComment`, `SharedItem`, `DraftComment` (Task 5); `DraftCommentThread` (Task 6); the auth token.
- Produces: `export function SharedWithYou(props: { token: string | null }): React.JSX.Element | null`

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/SharedWithYou.test.tsx`:

```tsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { SharedWithYou } from "@/components/SharedWithYou";

jest.mock("@/api/client", () => ({
  sharedWithMe: jest.fn(),
  getSharedDraft: jest.fn(),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn(),
}));
import * as api from "@/api/client";

it("renders nothing when signed out", () => {
  const { toJSON } = render(<SharedWithYou token={null} />);
  expect(toJSON()).toBeNull();
});

it("lists drafts shared with me", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([{ book_id: "b1", title: "Shared Book", owner_sub: "o", version: "1.0", updated_at: "" }]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(screen.getByText("Shared Book")).toBeTruthy());
});

it("renders nothing (no header) when the shared list is empty", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(api.sharedWithMe).toHaveBeenCalled());
  expect(screen.queryByText(/Shared with you/i)).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest __tests__/components/SharedWithYou.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `mobile/src/components/SharedWithYou.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getSharedDraft, listComments, postComment, sharedWithMe, type DraftComment, type SharedItem } from "@/api/client";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import { colors, radius, spacing, typography } from "@/constants/theme";

export function SharedWithYou({ token }: { token: string | null }): React.JSX.Element | null {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [open, setOpen] = useState<SharedItem | null>(null);
  const [comments, setComments] = useState<DraftComment[]>([]);

  useEffect(() => {
    if (!token) {
      setItems([]);
      return;
    }
    void sharedWithMe(token).then(setItems).catch(() => setItems([]));
  }, [token]);

  const openDraft = useCallback(
    async (item: SharedItem) => {
      if (!token) return;
      setOpen(item);
      try {
        await getSharedDraft(item.book_id, token); // fetch content (read view uses it; kept simple here)
        setComments(await listComments(item.book_id, item.version, token));
      } catch {
        setComments([]);
      }
    },
    [token],
  );

  if (!token || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Shared with you</Text>
      {items.map((it) => (
        <Pressable
          key={it.book_id}
          onPress={() => openDraft(it)}
          accessibilityRole="button"
          accessibilityLabel={`Open shared draft: ${it.title}`}
          style={styles.item}
        >
          <Text style={styles.itemTitle}>{it.title}</Text>
          <Text style={styles.itemMeta}>v{it.version}</Text>
        </Pressable>
      ))}
      {open ? (
        <View style={styles.reader}>
          <Text style={styles.readerTitle}>{open.title}</Text>
          <DraftCommentThread
            comments={comments}
            isOwner={false}
            onPost={(body) =>
              void postComment(open.book_id, open.version, body, token)
                .then(() => listComments(open.book_id, open.version, token))
                .then(setComments)
                .catch(() => {})
            }
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text, flexShrink: 1 },
  itemMeta: { fontSize: typography.sizeXs, color: colors.textMuted },
  reader: { marginTop: spacing.sm, gap: spacing.sm },
  readerTitle: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
});
```

Note: this MVP shows the shared draft's **title + comment thread** (a minimal read surface). Rendering the full `book_json` in the in-app reader is a follow-up refinement; the read + comment loop is exercised here.

- [ ] **Step 4: Mount in the Library tab**

In `mobile/app/(tabs)/library.tsx`, inside `EpubLibrary`, render `<SharedWithYou token={token} />` at the top of the list header (above the shelf bands). Obtain `token` from the same auth/session accessor `library.tsx` already uses (the `UserChip`/`useAuth` path); pass `null` when signed out (the component self-hides). Add the import: `import { SharedWithYou } from "@/components/SharedWithYou";`.

- [ ] **Step 5: Run to verify pass + full suite + typecheck + lint**

Run: `npx jest __tests__/components/SharedWithYou.test.tsx` → PASS.
Run: `npx jest` → full suite green. `npm run typecheck` → clean. `npm run lint` → no new warnings in touched files.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/SharedWithYou.tsx mobile/app/\(tabs\)/library.tsx mobile/__tests__/components/SharedWithYou.test.tsx
git commit -m "feat(sharing): recipient Shared-with-you section + read/comment"
```

- [ ] **Step 7: Manual live verification (controller)**

Requires the backend deployed with migration 0008 (see Rollout). With two signed-in accounts: author shares a draft + invites account B's email; account B sees it under "Shared with you", opens it, comments; author sees the comment and adds a response; author revokes → B loses access. (Until the backend is redeployed, the endpoints 404/503 — see Rollout.)

---

## Rollout / ops (post-merge, out of the task loop)

- CI runs the migration (`alembic upgrade head`) + repo tests against its Postgres, and the router tests without a DB.
- **Going live needs a prod backend redeploy + `alembic upgrade head`** on `/opt/mentible` (the backend is not auto-deployed). Until then the mobile calls fail closed (client throws → surfaces the friendly error; "Shared with you" shows nothing).
- ADR-027 D8: private, invite-only author content now lives server-side (readable by us/moderation). Public Open-Library gates (ADR-021 D8) are a separate sub-project.

## Self-Review

**Spec coverage:**
- shared_draft store + first-share-wins → Task 1 (`claim_or_share`/`upsert_draft`/`get_draft`). ✔
- invitations add/list/revoke/reactivate + `draft_access` + shared-with-me → Task 2. ✔
- version-scoped comments + owner author-response (empty clears) → Task 3. ✔
- API endpoints (share/get/invitations/shared-with-me/comments/response) + authz (owner vs invited) + rate-limit on writes + 503/403/404/422 → Task 4. ✔
- Registered-only, email-match authz on `Principal.email` → Task 2 `draft_access` + Task 4 `_require_access`. ✔
- Mobile client methods → Task 5; `DraftCommentThread` (isOwner gates response affordance) → Task 6; author `ShareDraftModal` + Share action → Task 7; recipient `SharedWithYou` + read/comment → Task 8. ✔
- Deferred items (guest/email/threading/paid gate) — not built (correct). ✔
- No comment body / book_json logged: repo/router never `log.info` bodies (only ids); noted in Global Constraints. ✔

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test has real assertions. The two "reuse the existing token accessor" notes (Tasks 7/8 wiring) point at concrete existing code (`publishBook` callers / `UserChip`) rather than inventing an API — acceptable, and the implementer verifies with `typecheck`. ✔

**Type consistency:** `SharedDraft`/`Invitation`/`Comment`/`SharedWithMe` (repo) ↔ `DraftOut`/`InvitationOut`/`CommentOut`/`SharedItem` (schemas) ↔ `DraftComment`/`SharedItem`/`DraftInvitation` (client) align on field names; `draft_access` returns `"owner"|"invited"|None` used consistently by `_require_owner`/`_require_access`; `DraftCommentThread` props (`comments`,`isOwner`,`onPost`,`onRespond`) match Tasks 7/8 usage. ✔
