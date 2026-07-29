# Trust HTTP Router (End-to-End Loop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first `/api/v1/trust` router exposing the end-to-end expert-validation loop: `POST /session/sync` (redeem-on-login), owner creates project/artifact/version + invites, reviewer reads + records an approval — composing the (b)/(c) repos + guard.

**Architecture:** One FastAPI `APIRouter` in `backend/src/trust/router.py` + Pydantic models in `backend/src/trust/schemas.py`, registered in `backend/main.py`. Each project-scoped endpoint resolves the caller's account then calls `require_project_access`. No changes to (b)/(c) repos or migrations. No UI.

**Tech Stack:** FastAPI, Pydantic v2, asyncpg, pytest + `fastapi.testclient.TestClient` with `dependency_overrides` for auth, live migrated Postgres.

**Spec:** `docs/superpowers/specs/2026-07-27-trust-router-design.md`.

## Global Constraints

- New files: `backend/src/trust/schemas.py`, `backend/src/trust/router.py`. Modify `backend/main.py` (register the router).
- Auth: `Depends(require_active_user)` → `Principal`; resolve account via `accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)`. Access via `require_project_access` (from (c)); catch `ProjectAccessError` → `HTTPException(403)`.
- Error mapping (house idiom, `sharing/router.py`): 403 no-access / owner-only; 404 unknown project/artifact/version; 422 bad enum (repo `ValueError`) or missing owner-supplied `expert_name`; 503 no DB pool (handled by `get_conn`).
- Multi-write requests (`session/sync`, artifact+version if combined) use `async with conn.transaction():`.
- **Tests:** `backend/tests/test_trust_router.py`, `from backend.main import app`, override `app.dependency_overrides[require_active_user] = lambda: Principal(...)`, drive with `TestClient(app)`. Run with `PYTHONPATH=<repo-root>` so `backend.*` resolves: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py -v`. Use **unique emails/subs per test** (`uuid4`) — the app owns its connections, so there is NO txn-rollback; the scratch DB accumulates rows (fine). `skipif(not DATABASE_URL)`.
- ruff on PATH (`~/.local/bin/ruff`), NOT `.venv/bin/ruff`. `router.py`/`schemas.py` contain no raw SQL (they call repos) → no S608.
- App-level authz only; the layering rule holds — trust imports accounts/auth/db, never the reverse.
- `Principal` fields (for the test override): `Principal(sub=..., email=..., issuer=..., is_super_admin=False)` (`backend/src/auth/principal.py`).

---

### Task 1: Router skeleton + `schemas.py` + `POST /session/sync` + register

**Files:**
- Create: `backend/src/trust/schemas.py`
- Create: `backend/src/trust/router.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `router` (APIRouter, prefix `/api/v1/trust`); helper `_account(conn, principal)`, `_require_role(conn, account, project_id, *, need_owner)`; `POST /session/sync`. All later tasks add endpoints to this same `router.py` and models to `schemas.py`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_router.py
import os, uuid
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def _as(sub, email):
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


def test_session_sync_no_email_no_memberships():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", None)
        body = c.post("/api/v1/trust/session/sync").json()
        assert body["memberships"] == []


def test_session_sync_fresh_account_returns_account_and_empty():
    with TestClient(app) as c:
        email = f"u-{uuid.uuid4()}@x.z"
        _as(f"u-{uuid.uuid4()}", email)
        body = c.post("/api/v1/trust/session/sync").json()
        assert body["email"] == email
        assert body["account_id"]  # account resolved/created
        assert body["memberships"] == []  # no invites for this fresh email
        # idempotent
        assert c.post("/api/v1/trust/session/sync").json()["memberships"] == []
```

> **Note:** Task 1 tests only the no-seed cases (the endpoint runs, resolves the account, returns empty memberships when there are no invites). The redeem *materialization* path — an invited email → a `reviewer` membership — is proven end-to-end in **Task 3** (`test_invite_then_reviewer_reads`: owner invites → expert `session/sync` → `GET` returns `my_role="reviewer"`), which needs the invite endpoint. Do not add async DB-seeding to this sync test.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: FAIL (404 — `/session/sync` not registered yet).

- [ ] **Step 3: Write `schemas.py`**

```python
# backend/src/trust/schemas.py
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class MembershipOut(BaseModel):
    project_id: str
    role: str


class SessionSyncOut(BaseModel):
    account_id: str
    email: str | None
    memberships: list[MembershipOut]


class ProjectCreateIn(BaseModel):
    title: str
    topic: str | None = None
    audience: str | None = None
    goal: str | None = None


class ProjectOut(BaseModel):
    id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None


class ArtifactCreateIn(BaseModel):
    role: str
    format: str
    title: str | None = None


class ArtifactOut(BaseModel):
    id: str
    project_id: str
    role: str
    format: str
    title: str | None
    created_at: datetime | None


class VersionCreateIn(BaseModel):
    content: dict
    generation_meta: dict | None = None


class VersionOut(BaseModel):
    id: str
    artifact_id: str
    version_no: int
    created_at: datetime | None


class VersionSummaryOut(BaseModel):
    id: str
    version_no: int
    created_at: datetime | None
    is_validated: bool


class ArtifactDetailOut(BaseModel):
    artifact: ArtifactOut
    versions: list[VersionSummaryOut]


class ProjectDetailOut(BaseModel):
    project: ProjectOut
    artifacts: list[ArtifactDetailOut]
    my_role: str


class InviteIn(BaseModel):
    email: str


class InvitationOut(BaseModel):
    project_id: str
    invited_email: str
    role: str
    revoked_at: datetime | None


class ApprovalIn(BaseModel):
    approved_at: datetime
    note: str | None = None
    expert_name: str | None = None
    expert_email: str | None = None
    expert_role: str | None = None


class ApprovalOut(BaseModel):
    id: str
    version_id: str
    expert_name: str
    approved_at: datetime
    recorded_via: str
```

- [ ] **Step 4: Write `router.py` (skeleton + helpers + session/sync)**

```python
# backend/src/trust/router.py
from __future__ import annotations
import uuid
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from ..accounts import repo as accounts_repo
from ..accounts.deps import require_active_user
from ..accounts.models import Account
from ..auth.principal import Principal
from ..db.deps import get_conn
from . import membership_repo
from .access import ProjectAccessError, require_project_access
from . import schemas

router = APIRouter(prefix="/api/v1/trust", tags=["trust"])


async def _account(conn: asyncpg.Connection, principal: Principal) -> Account:
    return await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )


async def _require_role(
    conn: asyncpg.Connection, account: Account, project_id: uuid.UUID, *, need_owner: bool
) -> str:
    try:
        role = await require_project_access(
            conn, account_id=account.id, project_id=project_id
        )
    except ProjectAccessError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this project")
    if need_owner and role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")
    return role


@router.post("/session/sync", response_model=schemas.SessionSyncOut)
async def session_sync(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.SessionSyncOut:
    async with conn.transaction():
        account = await _account(conn, principal)
        memberships = (
            await membership_repo.redeem_invitations_for(
                conn, account_id=account.id, email=principal.email
            )
            if principal.email
            else []
        )
    return schemas.SessionSyncOut(
        account_id=str(account.id),
        email=account.email,
        memberships=[
            schemas.MembershipOut(project_id=str(m.project_id), role=m.role)
            for m in memberships
        ],
    )
```

- [ ] **Step 5: Register in `backend/main.py`**

Add near the other imports and `include_router` calls:

```python
from src.trust import router as trust_router  # noqa: E402  (match the existing import style)
...
app.include_router(trust_router.router)
```

(Match the existing import convention in `main.py` — the other routers are imported as `from src.<domain> import router as <domain>_router`. Verify and mirror it exactly.)

- [ ] **Step 6: Run to verify pass**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: PASS (no-email + fresh-account empty-membership cases).

- [ ] **Step 7: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py && ruff format --check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/main.py backend/tests/test_trust_router.py
git commit -m "feat(trust): router skeleton + session/sync redeem endpoint (ADR-037)"
```

---

### Task 2: Owner authoring — `POST /projects`, `/artifacts`, `/versions`

**Files:**
- Modify: `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_router.py` (append)

**Interfaces:**
- Consumes: helpers from Task 1, `project_repo`, `artifact_repo`, `project_id_for_artifact`.
- Produces: `POST /projects`, `POST /projects/{project_id}/artifacts`, `POST /artifacts/{artifact_id}/versions`.

- [ ] **Step 1: Append failing tests**

```python
def test_owner_authoring_chain_and_non_owner_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "Guide", "topic": "t"}).json()["id"]
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        assert art["role"] == "cornerstone"
        ver = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions",
                     json={"content": {"t": "a"}}).json()
        assert ver["version_no"] == 1
        # a different account is not the owner → 403 on artifact create
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        r = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                   json={"role": "derivative", "format": "linkedin"})
        assert r.status_code == 403


def test_bad_enum_422_and_unknown_artifact_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        r = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                   json={"role": "bogus", "format": "book"})
        assert r.status_code == 422
        r2 = c.post(f"/api/v1/trust/artifacts/{uuid.uuid4()}/versions", json={"content": {}})
        assert r2.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -k "authoring or enum" -v`
Expected: FAIL (404 — endpoints not defined).

- [ ] **Step 3: Add the endpoints to `router.py`**

Add imports at the top: `from . import artifact_repo, project_repo` and `from .access import project_id_for_artifact`. Then:

```python
@router.post("/projects", response_model=schemas.ProjectOut)
async def create_project(
    body: schemas.ProjectCreateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectOut:
    account = await _account(conn, principal)
    p = await project_repo.create_project(
        conn, owner_account_id=account.id, title=body.title,
        topic=body.topic, audience=body.audience, goal=body.goal,
    )
    return schemas.ProjectOut(
        id=str(p.id), title=p.title, topic=p.topic, audience=p.audience,
        goal=p.goal, status=p.status, created_at=p.created_at,
    )


@router.post("/projects/{project_id}/artifacts", response_model=schemas.ArtifactOut)
async def create_artifact(
    project_id: uuid.UUID,
    body: schemas.ArtifactCreateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ArtifactOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    try:
        a = await artifact_repo.create_artifact(
            conn, project_id=project_id, role=body.role, format=body.format, title=body.title,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    return schemas.ArtifactOut(
        id=str(a.id), project_id=str(a.project_id), role=a.role,
        format=a.format, title=a.title, created_at=a.created_at,
    )


@router.post("/artifacts/{artifact_id}/versions", response_model=schemas.VersionOut)
async def create_version(
    artifact_id: uuid.UUID,
    body: schemas.VersionCreateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.VersionOut:
    project_id = await project_id_for_artifact(conn, artifact_id=artifact_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    v = await artifact_repo.create_version(
        conn, artifact_id=artifact_id, content=body.content,
        created_by_sub=principal.sub, generation_meta=body.generation_meta,
    )
    return schemas.VersionOut(
        id=str(v.id), artifact_id=str(v.artifact_id),
        version_no=v.version_no, created_at=v.created_at,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: PASS (authoring chain, non-owner 403, bad-enum 422, unknown-artifact 404).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py tests/test_trust_router.py && ruff format --check src/trust/router.py tests/test_trust_router.py
git add backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): owner authoring endpoints — project/artifact/version (ADR-037)"
```

---

### Task 3: `POST /projects/{id}/invitations` + `GET /projects/{id}`

**Files:**
- Modify: `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_router.py` (append)

**Interfaces:**
- Consumes: helpers, `membership_repo`, `project_repo`, `artifact_repo`, `approval_repo.is_validated`.
- Produces: `POST /projects/{project_id}/invitations`, `GET /projects/{project_id}`.

- [ ] **Step 1: Append failing tests**

```python
def test_invite_then_reviewer_reads():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}})
        inv = c.post(f"/api/v1/trust/projects/{pid}/invitations",
                     json={"email": expert_email}).json()
        assert inv["invited_email"] == expert_email and inv["role"] == "reviewer"
        # expert redeems then reads
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["my_role"] == "reviewer"
        assert detail["artifacts"][0]["versions"][0]["is_validated"] is False


def test_stranger_cannot_read_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        c.post("/api/v1/trust/session/sync")
        assert c.get(f"/api/v1/trust/projects/{pid}").status_code == 403
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -k "invite or stranger" -v`
Expected: FAIL (404/405 — endpoints missing).

- [ ] **Step 3: Add the endpoints**

Add `from . import approval_repo` at the top, then:

```python
@router.post("/projects/{project_id}/invitations", response_model=schemas.InvitationOut)
async def invite_expert(
    project_id: uuid.UUID,
    body: schemas.InviteIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.InvitationOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    inv = await membership_repo.invite(
        conn, project_id=project_id, email=body.email, invited_by_sub=principal.sub,
    )
    return schemas.InvitationOut(
        project_id=str(inv.project_id), invited_email=inv.invited_email,
        role=inv.role, revoked_at=inv.revoked_at,
    )


@router.get("/projects/{project_id}", response_model=schemas.ProjectDetailOut)
async def get_project(
    project_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectDetailOut:
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, need_owner=False)
    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    artifacts = []
    for a in await artifact_repo.list_artifacts(conn, project_id=project_id):
        versions = []
        for v in await artifact_repo.list_versions(conn, artifact_id=a.id):
            validated = await approval_repo.is_validated(conn, version_id=v.id)
            versions.append(schemas.VersionSummaryOut(
                id=str(v.id), version_no=v.version_no,
                created_at=v.created_at, is_validated=validated,
            ))
        artifacts.append(schemas.ArtifactDetailOut(
            artifact=schemas.ArtifactOut(
                id=str(a.id), project_id=str(a.project_id), role=a.role,
                format=a.format, title=a.title, created_at=a.created_at,
            ),
            versions=versions,
        ))
    return schemas.ProjectDetailOut(
        project=schemas.ProjectOut(
            id=str(p.id), title=p.title, topic=p.topic, audience=p.audience,
            goal=p.goal, status=p.status, created_at=p.created_at,
        ),
        artifacts=artifacts, my_role=role,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py tests/test_trust_router.py && ruff format --check src/trust/router.py tests/test_trust_router.py
git add backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): invite + project-detail read endpoints (ADR-037)"
```

---

### Task 4: `POST /versions/{id}/approvals` — the provenance payoff

**Files:**
- Modify: `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_router.py` (append)

**Interfaces:**
- Consumes: helpers, `project_id_for_version`, `approval_repo.record_approval`.
- Produces: `POST /versions/{version_id}/approvals`.

- [ ] **Step 1: Append failing tests**

```python
def test_reviewer_approval_is_expert_self():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions",
                     json={"content": {}}).json()["id"]
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        ap = c.post(f"/api/v1/trust/versions/{vid}/approvals",
                    json={"approved_at": "2026-07-27T00:00:00Z"}).json()
        assert ap["recorded_via"] == "expert_self"
        assert ap["expert_name"] == expert_email  # from the reviewer's account
        # now validated
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["artifacts"][0]["versions"][0]["is_validated"] is True


def test_owner_approval_requires_expert_name():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions",
                     json={"content": {}}).json()["id"]
        # owner records on an expert's behalf: missing expert_name → 422
        r = c.post(f"/api/v1/trust/versions/{vid}/approvals",
                   json={"approved_at": "2026-07-27T00:00:00Z"})
        assert r.status_code == 422
        ap = c.post(f"/api/v1/trust/versions/{vid}/approvals",
                    json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr X"}).json()
        assert ap["recorded_via"] == "operator" and ap["expert_name"] == "Dr X"


def test_approval_unknown_version_404():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"u-{uuid.uuid4()}@x.z")
        r = c.post(f"/api/v1/trust/versions/{uuid.uuid4()}/approvals",
                   json={"approved_at": "2026-07-27T00:00:00Z"})
        assert r.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -k approval -v`
Expected: FAIL (404 — endpoint missing).

- [ ] **Step 3: Add the endpoint**

Add `from .access import project_id_for_version` at the top, then:

```python
@router.post("/versions/{version_id}/approvals", response_model=schemas.ApprovalOut)
async def record_version_approval(
    version_id: uuid.UUID,
    body: schemas.ApprovalIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ApprovalOut:
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, need_owner=False)
    if role == "reviewer":
        recorded_via = "expert_self"
        expert_name = account.email or principal.sub
        expert_email = account.email
        expert_role = body.expert_role
    else:  # owner records on a named expert's behalf
        recorded_via = "operator"
        if not body.expert_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "expert_name is required when an owner records an approval",
            )
        expert_name = body.expert_name
        expert_email = body.expert_email
        expert_role = body.expert_role
    ap = await approval_repo.record_approval(
        conn, version_id=version_id, expert_name=expert_name,
        approved_at=body.approved_at, recorded_by_sub=principal.sub,
        expert_email=expert_email, expert_role=expert_role,
        note=body.note, recorded_via=recorded_via,
    )
    return schemas.ApprovalOut(
        id=str(ap.id), version_id=str(ap.version_id), expert_name=ap.expert_name,
        approved_at=ap.approved_at, recorded_via=ap.recorded_via,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: PASS (expert_self from reviewer, operator + 422 for owner, 404 unknown version, is_validated flips true).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py tests/test_trust_router.py && ruff format --check src/trust/router.py tests/test_trust_router.py
git add backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): approval endpoint with reviewer/owner provenance (ADR-037)"
```

---

## Final verification

- [ ] Whole router suite: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v` — all pass; and the repo suite still green: `... tests/test_trust_*.py`.
- [ ] Lint: `cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust tests/test_trust_router.py && ruff format --check src/trust tests/test_trust_router.py`.
- [ ] `main.py` registers exactly one new `include_router`; no other router touched.
- [ ] Every project-scoped endpoint composes account-resolution + `require_project_access`; `ProjectAccessError`→403; the layering rule holds (trust imports accounts/auth/db, never reverse).
- [ ] The reviewer-approval path yields `recorded_via="expert_self"`; the owner path requires `expert_name` and yields `"operator"`.
