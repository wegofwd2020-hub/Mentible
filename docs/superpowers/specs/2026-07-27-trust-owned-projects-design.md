# Trust — Owned-Projects List + Approval Provenance in Detail — Design Spec

**Status:** Approved (2026-07-27) · **ADR-037 follow-on**, extends the trust router ([#344]).
**Builds on:** the trust router (#344) + (b)[#342] + (c)[#343]. This branch is cut from `feat/trust-router`; its diff includes #344 until it merges.
**Scope:** two small backend additions to the existing trust router that unblock the next UI slices — (1) `GET /api/v1/trust/projects` returning the caller's **owned** projects; (2) a `recorded_via` field on the per-version summary in `GET /projects/{id}`. Backend-only; no new tables, no migration.

## Why
- The router has no way to list projects a user **owns** (only reviewer memberships via `session/sync`, and single-project GET). The owner-authoring UI can't list its projects without this.
- The `GET /projects/{id}` version summary returns `is_validated` but not the approval's **provenance** — so a client can't render the required `expert_self` vs `operator` badge (the pinned "badges must render `recorded_via`" carry-forward). Both are the same small surface.

## Grounding (reuse what exists)
- `project_repo.list_projects(conn, *, owner_account_id) -> list[Project]` **already exists** (sub-project b). The owned-list endpoint just wraps it.
- `approval_repo.get_approval(conn, *, version_id) -> Approval | None` **already exists** (Approval carries `recorded_via`). The detail endpoint already loops versions calling `is_validated`; swap that for `get_approval` to get both `is_validated` (row exists) and `recorded_via` in one call.
- Router idiom + auth: `require_active_user` → `get_or_create_account` → account (owned-list needs no per-project guard — it's scoped by `account.id`). Detail endpoint's `require_project_access` is unchanged.

## Global Constraints
- Edit only `backend/src/trust/router.py` + `backend/src/trust/schemas.py`; extend `backend/tests/test_trust_router.py`. No repo/migration changes (both repo functions exist).
- Response shape of `GET /projects/{id}` is unchanged except the **added** `recorded_via` field on each version summary (backward-compatible addition).
- Endpoint tests: `TestClient` + `require_active_user` override + `PYTHONPATH=repo-root` (the established idiom); live migrated DB; unique subs/emails per test.
- App-level authz only; layering unchanged.

---

## Addition 1 — `GET /api/v1/trust/projects` (owned list)

Any authenticated user → their **owned** projects (creator = owner via `project.owner_account_id`).

- Logic: resolve account → `project_repo.list_projects(conn, owner_account_id=account.id)`.
- Response `list[ProjectSummary]` where `ProjectSummary = { id, title, status, created_at }` (minimal — the client fetches full detail on tap).
- No `require_project_access` (the query is already account-scoped; you only ever see your own owned rows).
- Empty list when the caller owns nothing (e.g. a pure reviewer).

New schema:
```python
class ProjectSummaryOut(BaseModel):
    id: str
    title: str
    status: str
    created_at: datetime | None
```

## Addition 2 — `recorded_via` on the version summary

Extend `VersionSummaryOut`:
```python
class VersionSummaryOut(BaseModel):
    id: str
    version_no: int
    created_at: datetime | None
    is_validated: bool
    recorded_via: str | None   # NEW: 'expert_self' | 'operator' | None (unvalidated)
```

In `get_project`, per version, replace the `is_validated(...)` call with a single `get_approval(...)`:
```python
ap = await approval_repo.get_approval(conn, version_id=v.id)
VersionSummaryOut(
    id=str(v.id), version_no=v.version_no, created_at=v.created_at,
    is_validated=ap is not None,
    recorded_via=ap.recorded_via if ap else None,
)
```
Same response shape as before plus the new field; `is_validated` stays correct (`ap is not None` ≡ the old `EXISTS`). (`get_approval` returns the most-recent approval, so `recorded_via` reflects the latest — consistent with `is_validated`.)

---

## Testing (`backend/tests/test_trust_router.py`, append)
`TestClient` + auth override, live DB, `PYTHONPATH=repo-root`:
- **Owned list:** an owner creates 2 projects → `GET /api/v1/trust/projects` returns both (ids present, `status="active"`); a *different* account's owned list does **not** include them (scoping); a pure reviewer (invited only) gets an empty/owned-only list (their reviewed project is NOT owned).
- **`recorded_via` in detail:** create project+artifact+version; before approval `GET /projects/{id}` → the version has `is_validated=false, recorded_via=null`; owner records an `operator` approval → detail shows `is_validated=true, recorded_via="operator"`; (reviewer path already covered in #344 — optionally assert `expert_self` surfaces here too).

## Out of scope
- The UI that consumes these (owner-authoring screens + the `recorded_via` badge) — later mobile slices.
- Pagination / counts on the owned list (minimal shape now).
- Any change to `session/sync`, membership, or the approval write path.

## Open items (resolve in the plan, non-blocking)
1. Whether the owned list should also include projects where the caller is a `reviewer` (i.e. a unified "all my projects"). Spec keeps it **owned-only** (reviewer projects already come from `session/sync`); the client merges the two views if it wants a combined list.
2. Ordering of the owned list — `project_repo.list_projects` already orders `created_at DESC, id DESC`; the endpoint returns that order.
