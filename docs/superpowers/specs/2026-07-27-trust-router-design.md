# Trust HTTP Router (End-to-End Loop) — Design Spec

**Status:** Approved (2026-07-27) · **ADR-037 follow-on** to sub-projects (b) [#342] + (c) [#343].
**Builds on:** (b) trust persistence + (c) expert-login. This branch is cut from `feat/trust-expert-login`; its diff includes (b)+(c) until they merge.
**Scope:** one thin **vertical HTTP slice** that makes "trust is the product" real end-to-end — an operator creates a project + a version, invites an expert, the expert logs in (redeem) and records an approval. First **trust router**; composes the (b)/(c) repos + guard. **No UI.** Not the full operator authoring CRUD (that's a later slice).

## Why this slice
(b) built the data model, (c) the authz + redeem bridge — but both are callable only from tests (no HTTP). This wires the smallest set of endpoints that exercises the whole loop through real auth, closing (c)'s two carry-forwards (redeem-in-request-txn; verified email↔account).

## Grounding — router idiom (follow exactly)
- `APIRouter(prefix="/api/v1/trust", tags=["trust"])`, registered in `backend/main.py` via `app.include_router(...)` (alongside the other 9 routers).
- Auth: `Depends(require_active_user)` (`backend/src/accounts/deps.py`) → a `Principal`; resolve the account with `accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)` (the lazy-provision pattern from `accounts/router.py`).
- Access: catch `trust.access.ProjectAccessError` → `HTTPException(403)`. No DB pool → `HTTPException(503)`. Not found → `HTTPException(404)`. (Matches `sharing/router.py`.)
- DB: `Depends(get_conn)` (`backend/src/db/deps.py`); asyncpg connection; wrap multi-step writes in `async with conn.transaction():` where a single request does >1 write (redeem, create-artifact+version).
- Layer rule: **trust may depend on accounts/auth/db; accounts/auth must NOT import trust.** That is why redeem lives on a trust endpoint the app calls, never inside `require_active_user`.

## Global Constraints
- New code under `backend/src/trust/`: `router.py` (endpoints), `schemas.py` (Pydantic request/response). Register in `backend/main.py`.
- Every project-scoped endpoint composes: resolve account → `require_project_access(conn, account_id=account.id, project_id=...)` (from (c), returns `"owner"`/`"reviewer"`) → 403 on `ProjectAccessError`.
- Write endpoints that mutate on behalf of a role gate on the returned role (owner-only endpoints require `== "owner"`; approval accepts owner or reviewer).
- Pydantic v2 models (`BaseModel`); response models expose only the fields the client needs (no raw `recorded_by_sub` leakage beyond what's already modeled).
- **Endpoint tests** (`backend/tests/test_trust_router.py`): `from backend.main import app`; override auth via `app.dependency_overrides[require_active_user] = lambda: Principal(...)`; drive with `httpx.AsyncClient(ASGITransport(app=app))` (async) or `TestClient` (the `test_account_api.py` idiom). Run with **`PYTHONPATH=<repo-root>`** so `backend.*` imports resolve: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py`. Each test uses the live migrated DB; clean up rows or run in a rollback fixture. `skipif(not DATABASE_URL)`.
- ruff on PATH (`~/.local/bin/ruff`); `router.py`/`schemas.py` are NOT `*_repo.py`, so the S608 ignore does not apply — but these files use no raw SQL (they call repos), so no S608.
- App-level authz only (no RLS); no changes to (b)/(c) repos or migrations.

---

## Endpoints (`/api/v1/trust`)

### `POST /session/sync` — the redeem-on-login wiring
Any authenticated user. Resolves/creates the caller's account and materializes any pending invitations.

- Body: none.
- Logic: `async with conn.transaction():` → `account = get_or_create_account(sub, email)` → `memberships = redeem_invitations_for(conn, account_id=account.id, email=principal.email)`.
- Response `SessionSyncOut`: `{ account_id, email, memberships: [{project_id, role}] }`.
- Closes (c) carry-forwards: redeem runs **in the request transaction**, and `email` comes from the **verified** `Principal` (so email↔account_id is guaranteed).
- If `principal.email` is null → redeem is a no-op (return account + empty memberships).

### `POST /projects` — create a project (owner)
- Body `ProjectCreateIn`: `{ title, topic?, audience?, goal? }`.
- Logic: resolve account → `project_repo.create_project(owner_account_id=account.id, ...)`. Creator is implicitly the owner (ownership on `project.owner_account_id`; no membership row).
- Response `ProjectOut`: `{ id, title, topic, audience, goal, status, created_at }`.

### `POST /projects/{project_id}/artifacts` — create an artifact (owner)
- Gate: `require_project_access` must return `"owner"` (else 403).
- Body `ArtifactCreateIn`: `{ role, format, title? }` (validated by the repo enums → `ValueError` → 422).
- Response `ArtifactOut`: `{ id, project_id, role, format, title, created_at }`.

### `POST /artifacts/{artifact_id}/versions` — add a version (owner)
- Resolve project: `project_id = project_id_for_artifact(conn, artifact_id=...)`; 404 if None; then `require_project_access` == `"owner"`.
- Body `VersionCreateIn`: `{ content: dict, generation_meta?: dict }`.
- Logic: `artifact_repo.create_version(artifact_id, content, created_by_sub=principal.sub, generation_meta=...)`.
- Response `VersionOut`: `{ id, artifact_id, version_no, created_at }` (omit the full `content` blob from the create response; it is available via GET).

### `POST /projects/{project_id}/invitations` — invite an expert (owner)
- Gate: `"owner"`.
- Body `InviteIn`: `{ email }`.
- Logic: `membership_repo.invite(project_id, email, invited_by_sub=principal.sub)` (role defaults `reviewer`).
- Response `InvitationOut`: `{ project_id, invited_email, role, revoked_at }`.

### `GET /projects/{project_id}` — read the project (owner | reviewer)
- Gate: `require_project_access` returns any role (owner or reviewer); 403 otherwise.
- Logic: `project_repo.get_project` + `artifact_repo.list_artifacts` + per artifact `list_versions`.
- Response `ProjectDetailOut`: `{ project, artifacts: [{artifact, versions: [{id, version_no, created_at, is_validated}]}], my_role }`. `is_validated` from `approval_repo.is_validated(version_id)`.

### `POST /versions/{version_id}/approvals` — record an approval (owner | reviewer)
- Resolve project: `project_id = project_id_for_version(conn, version_id=...)`; 404 if None; `role = require_project_access(...)`.
- Body `ApprovalIn`: `{ approved_at, note?, expert_name?, expert_email?, expert_role? }`.
- **Provenance logic (the payoff):**
  - `role == "reviewer"` → `recorded_via="expert_self"`; `expert_name`/`expert_email` come from the **caller's account** (`account.email`; name from email/claim) — the body's expert fields are ignored (the authenticated expert IS the expert).
  - `role == "owner"` → `recorded_via="operator"`; `expert_name` is **required** from the body (the operator is recording on a named expert's behalf) → 422 if missing.
- Logic: `approval_repo.record_approval(version_id, expert_name, approved_at, recorded_by_sub=principal.sub, expert_email, expert_role, note, recorded_via)`.
- Response `ApprovalOut`: `{ id, version_id, expert_name, approved_at, recorded_via }`.

---

## Files
- `backend/src/trust/schemas.py` — the Pydantic models above.
- `backend/src/trust/router.py` — the 7 endpoints + a private access helper `async def _account_and_role(conn, principal, project_id, *, need_owner=False) -> tuple[Account, str]` (resolves account, calls the guard, raises 403/422).
- `backend/main.py` — one `app.include_router(trust_router.router)` line + import.

## Testing (`backend/tests/test_trust_router.py`)
Auth-overridden endpoint tests, live DB, `PYTHONPATH=repo-root`. Cover:
- `session/sync` — invited expert's first sync creates the membership (returns it); idempotent second sync; no-email caller → empty memberships.
- Owner creates project → artifact → version (happy path, 200s); a non-owner calling these → 403.
- Owner invites; a stranger (no invite) syncing gets no membership → GET project → 403.
- Reviewer (post-redeem) `GET /projects/{id}` → 200 with `my_role="reviewer"`; can `POST /versions/{id}/approvals` → `recorded_via="expert_self"`, name from their account.
- Owner `POST approvals` without `expert_name` → 422; with it → `recorded_via="operator"`.
- Unknown artifact/version id → 404; missing project → 404; no-DB (pool None) path → 503 (if feasible to simulate; otherwise omit).

## Out of scope (later slices)
- Full operator authoring CRUD (edit/delete project/input/artifact; list projects; feedback endpoints; revoke/list invitations UI).
- Mobile/web UI.
- Wiring `session/sync` into the app's actual login lifecycle (the endpoint exists; the client call is a mobile task).
- Pagination, rate limits, optimistic concurrency on versions.
- Real IdP end-to-end (tests inject a `Principal`).

## Open items (resolve in the plan, non-blocking)
1. `expert_name` for `expert_self`: derive from `account.email` (local-part) or a future account display-name? Spec uses `account.email` as both name and email for the reviewer case until accounts carry a display name.
2. Whether `GET /projects/{id}` should include `feedback` per version — deferred (read is enough to review + approve; feedback listing is a later slice).
3. `session/sync` response could also list projects the caller **owns** (not just redeemed memberships) — deferred; the client can fetch owned projects when the owner-list endpoint lands.
