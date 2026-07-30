# Trust Owned-Projects + recorded_via — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/v1/trust/projects` (the caller's owned projects) and a `recorded_via` field on the per-version summary of `GET /projects/{id}` — the two backend gaps blocking the owner-authoring UI and the provenance badge.

**Architecture:** Two additive edits to the existing trust router — `backend/src/trust/router.py` + `backend/src/trust/schemas.py` — reusing `project_repo.list_projects` and `approval_repo.get_approval` (both already exist). No repo changes, no migration.

**Tech Stack:** FastAPI, Pydantic v2, asyncpg, pytest + `TestClient`, live migrated Postgres.

**Spec:** `docs/superpowers/specs/2026-07-27-trust-owned-projects-design.md`.

## Global Constraints

- Edit only `backend/src/trust/router.py` + `backend/src/trust/schemas.py`; extend `backend/tests/test_trust_router.py`. No repo/migration edits.
- Both additions are backward-compatible (new endpoint; new optional field on an existing response).
- Tests: `from backend.main import app`, override `require_active_user`, `TestClient`, run `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py -v`. Unique subs/emails per test. DB migrated to `0010`.
- `ruff` on PATH (`~/.local/bin/ruff`); `router.py`/`schemas.py` call repos (no raw SQL) → no S608.
- `project_repo`, `approval_repo`, `_account`, `require_active_user`, `get_conn` are already imported in `router.py` (from the #344 work) — verify before adding; import only what's missing.

---

### Task 1: `GET /api/v1/trust/projects` — owned-projects list

**Files:**
- Modify: `backend/src/trust/schemas.py` (add `ProjectSummaryOut`), `backend/src/trust/router.py` (add endpoint)
- Test: `backend/tests/test_trust_router.py` (append)

**Interfaces:**
- Produces: `GET /api/v1/trust/projects -> list[ProjectSummaryOut]` (owned, account-scoped).

- [ ] **Step 1: Append the failing test**

```python
def test_owned_projects_list_scoped():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        p1 = c.post("/api/v1/trust/projects", json={"title": "P1"}).json()["id"]
        p2 = c.post("/api/v1/trust/projects", json={"title": "P2"}).json()["id"]
        mine = c.get("/api/v1/trust/projects").json()
        ids = {p["id"] for p in mine}
        assert {p1, p2} <= ids
        assert all(p["status"] == "active" for p in mine if p["id"] in {p1, p2})
        # a different account does not see them
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        other = c.get("/api/v1/trust/projects").json()
        assert {p1, p2}.isdisjoint({p["id"] for p in other})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -k owned_projects -v`
Expected: FAIL (404 — endpoint missing).

- [ ] **Step 3: Add the schema** (in `schemas.py`, near `ProjectOut`)

```python
class ProjectSummaryOut(BaseModel):
    id: str
    title: str
    status: str
    created_at: datetime | None
```

- [ ] **Step 4: Add the endpoint** (in `router.py`)

Declare it BEFORE the `GET /projects/{project_id}` route (FastAPI matches literal `/projects` distinctly, but keep it adjacent/above for clarity):

```python
@router.get("/projects", response_model=list[schemas.ProjectSummaryOut])
async def list_owned_projects(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[schemas.ProjectSummaryOut]:
    account = await _account(conn, principal)
    projects = await project_repo.list_projects(conn, owner_account_id=account.id)
    return [
        schemas.ProjectSummaryOut(
            id=str(p.id), title=p.title, status=p.status, created_at=p.created_at,
        )
        for p in projects
    ]
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: PASS (owned list returns the owner's projects; other account excluded).

- [ ] **Step 6: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py && ruff format --check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_router.py
git commit -m "feat(trust): GET /projects owned-list endpoint (ADR-037)"
```

---

### Task 2: `recorded_via` on the version summary

**Files:**
- Modify: `backend/src/trust/schemas.py` (`VersionSummaryOut`), `backend/src/trust/router.py` (`get_project`)
- Test: `backend/tests/test_trust_router.py` (append)

**Interfaces:**
- Consumes: `approval_repo.get_approval` (exists). Produces: `VersionSummaryOut.recorded_via: str | None` populated in `GET /projects/{id}`.

- [ ] **Step 1: Append the failing test**

```python
def test_version_summary_recorded_via():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions",
                     json={"content": {}}).json()["id"]
        # before approval: not validated, no provenance
        v0 = c.get(f"/api/v1/trust/projects/{pid}").json()["artifacts"][0]["versions"][0]
        assert v0["is_validated"] is False and v0["recorded_via"] is None
        # owner records an operator approval
        c.post(f"/api/v1/trust/versions/{vid}/approvals",
               json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr X"})
        v1 = c.get(f"/api/v1/trust/projects/{pid}").json()["artifacts"][0]["versions"][0]
        assert v1["is_validated"] is True and v1["recorded_via"] == "operator"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -k recorded_via -v`
Expected: FAIL (`KeyError: 'recorded_via'` — field not in the response yet).

- [ ] **Step 3: Extend the schema** (`schemas.py`, `VersionSummaryOut`) — add the field:

```python
class VersionSummaryOut(BaseModel):
    id: str
    version_no: int
    created_at: datetime | None
    is_validated: bool
    recorded_via: str | None = None
```

- [ ] **Step 4: Populate it in `get_project`** (`router.py`) — replace the per-version `is_validated` call with `get_approval`:

Find the version loop inside `get_project` (currently builds `VersionSummaryOut` with `is_validated=await approval_repo.is_validated(conn, version_id=v.id)`). Replace that per-version block with:

```python
ap = await approval_repo.get_approval(conn, version_id=v.id)
versions.append(
    schemas.VersionSummaryOut(
        id=str(v.id),
        version_no=v.version_no,
        created_at=v.created_at,
        is_validated=ap is not None,
        recorded_via=ap.recorded_via if ap else None,
    )
)
```
(`ap is not None` is equivalent to the previous `is_validated` EXISTS check; one query now yields both fields. Leave the rest of `get_project` untouched.)

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_router.py -v`
Expected: PASS (pre-approval `is_validated=false/recorded_via=null`; post `operator` approval `true/"operator"`; all prior router tests still green — the response shape only GAINED a field).

- [ ] **Step 6: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py && ruff format --check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_router.py
git commit -m "feat(trust): recorded_via on version summary in GET /projects/{id} (ADR-037)"
```

---

## Final verification

- [ ] Whole trust suite: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=$DSN .venv/bin/pytest tests/test_trust_*.py -v` — all pass (the new owned-list + recorded_via tests plus every prior trust test).
- [ ] Lint: `cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust tests/test_trust_router.py && ruff format --check src/trust tests/test_trust_router.py`.
- [ ] `GET /projects/{id}` response shape unchanged except the added `recorded_via` (no existing test broke).
- [ ] No repo or migration files touched; only `router.py` + `schemas.py` + the test file.
