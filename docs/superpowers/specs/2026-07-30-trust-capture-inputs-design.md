# Trust Capture — Project Sources (inputs) — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 Phase 01 "Capture"** · first slice of the guided-authorship program (Capture → Create → Validate → Share). Precedes source-cited **Create** (A2) and the four-phase wayfinding **handhold** (Phase B).
**Scope:** expose the already-built `project_input` layer over HTTP + a mobile **Sources** surface, so an SME can add raw knowledge (paste a transcript / note / link) to a trust project and everyone with access can see it. Backend endpoints + schemas + mobile UI only. **No migration, no repo changes, no generation, no file upload.**

## Why this slice
The trust workspace has Validate (approvals) and Share (derivatives/Posts) built, but **Capture and Create are not usable in the app**. The direction doc's studio loop starts at Intake ("paste transcripts, notes; upload files"), and source-cited Create (§8/§14 "traceability by default") needs sources to cite. This slice makes Capture real — the first phase of the handhold — and gives Create (next slice) something to ground + cite.

## Grounding (verified)
- **Table + repo already exist and are repo-tested** — no migration, no repo code:
  - `project_input` table: `backend/alembic/versions/0009_trust_validation.py:35`.
  - `backend/src/trust/project_repo.py`: `add_input(conn, *, project_id, kind, title=None, content=None, source_ref=None) -> ProjectInput` (raises `ValueError` if `kind not in INPUT_KINDS`); `list_inputs(conn, *, project_id) -> list[ProjectInput]`.
  - `INPUT_KINDS = ("transcript", "note", "upload", "link")` (`models.py:7`); `ProjectInput` fields: `id, project_id, kind, title, content, source_ref, storage_path, content_hash, created_at`.
- **Access seam:** router endpoints use `_account(conn, principal)` + `_require_role(conn, account, project_id, need_owner=<bool>)` (built on `access.require_project_access` → `"owner"` / membership `"reviewer"` / raises). Deps: `require_active_user` (→ `Principal`) + `get_conn`. Mirror `create_artifact` (`router.py:91`) exactly.
- **Detail assembly:** `GET /projects/{id}` builds `ProjectDetailOut { project, artifacts, my_role }` (`router.py:188`). This slice adds `inputs`.

---

## Backend

### `schemas.py`
```python
InputKind = Literal["transcript", "note", "link"]   # "upload" deferred (no blob storage this slice)

class ProjectInputIn(BaseModel):
    kind: InputKind
    title: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=200_000)  # pasted transcript/note, or the link text/URL
    source_ref: str | None = Field(default=None, max_length=500)  # optional citation handle Create (A2) will use

class ProjectInputOut(BaseModel):
    id: str
    kind: str
    title: str | None
    content: str
    source_ref: str | None
    created_at: datetime | None
```
- Add `inputs: list[ProjectInputOut]` to `ProjectDetailOut`.

### `router.py`
- **`POST /projects/{project_id}/inputs`** → `ProjectInputOut`, **owner-only** (mirror `create_artifact`):
  ```python
  account = await _account(conn, principal)
  await _require_role(conn, account, project_id, need_owner=True)
  try:
      i = await project_repo.add_input(conn, project_id=project_id, kind=body.kind,
                                       title=body.title, content=body.content, source_ref=body.source_ref)
  except ValueError as e:
      raise HTTPException(422, str(e)) from e
  return schemas.ProjectInputOut(id=str(i.id), kind=i.kind, title=i.title,
                                 content=i.content, source_ref=i.source_ref, created_at=i.created_at)
  ```
  - Access denial (no owner/membership) → the existing `ProjectAccessError` handling (404/403 as the other endpoints do). Reviewer POST → denied (need_owner).
- **`GET /projects/{project_id}`** — after resolving access + assembling artifacts, add:
  ```python
  inputs = [schemas.ProjectInputOut(...) for i in await project_repo.list_inputs(conn, project_id=project_id)]
  ```
  and include `inputs=inputs` in `ProjectDetailOut`. Visible to **owner + reviewer** (any project access), so a reviewer can see the sources behind a draft they validate.

### Boundaries (backend)
- `kind` limited to `transcript|note|link` at the schema boundary (`upload` is a valid repo kind but blocked here — no file storage). `content` is required text; for a `link`, the URL/label goes in `content` (+ optionally `source_ref`).
- No `storage_path`/`content_hash` handling (upload-only fields; untouched).
- No generation, no dedup, no `usage_event`.

---

## Mobile

- `src/api/trustClient.ts`: `ProjectInputView { id, kind, title, content, source_ref, created_at }`; `addProjectInput(projectId, body: {kind, title?, content, source_ref?}, token) -> ProjectInputView` (POST, JWT, mirrors `createArtifact`); `ProjectDetailView` gains `inputs: ProjectInputView[]`.
- `src/hooks/useTrustProject.ts`: expose `inputs` from the detail; add `addInput(body)` mutation (calls the client, refreshes on success), mirroring the existing `addArtifact`/`invite` mutations.
- `app/trust/[projectId].tsx`: a **"Sources"** section:
  - **Owner** sees an add affordance: a kind selector (Transcript / Note / Link — segmented), an optional title field, a multiline **paste** box, and an "Add source" button (disabled until content is non-empty). On success it clears + the list updates.
  - **All roles** (owner + reviewer) see the list of sources: each row shows kind + title (or a content preview) + when added.
  - Empty state: "No sources yet. Paste a transcript, note, or link to capture the expert's raw knowledge." (owner) / "No sources yet." (reviewer).
  - Gated like the existing owner-only actions (`my_role === "owner"` for the add form); web-safe (`@/lib/alert` if any confirm needed — none expected).

## Testing
**Backend** (endpoint tests, mirror `test_trust_router`/`test_trust_*` against the live PG pattern):
- owner adds an input → 200, appears in a subsequent `GET /projects/{id}` `inputs`.
- reviewer (redeemed membership) → **cannot** POST an input (denied) but **can** see `inputs` in GET.
- non-member → denied on both.
- unknown/blocked kind (`"upload"` or garbage) → 422.
- empty `content` → 422.

**Mobile** (Jest/RNTL, mock the client/hook):
- owner sees the add form; adding calls `addProjectInput` with the entered kind/content and refreshes.
- reviewer sees the source list but **not** the add form.
- source list renders items from `inputs`.

**Help / DoD gate:** add a `sources` (or `capture`) FEATURES key + a Help topic explaining that Sources are the raw material an expert captures, that pasting a transcript/note/link is the first phase, and that they stay private to the project.

## Out of scope (later slices)
- **Create (A2)** — generating a source-cited draft *from* these inputs (the next slice; this slice only captures).
- **File upload** (`upload` kind + blob storage) + transcription of audio/video.
- Editing/deleting an input (add + list only this slice).
- Per-claim citation UI (Create surfaces citations; source_ref is just stored here).
- The four-phase wayfinding handhold (Phase B).

## Open items (resolve in the plan, non-blocking)
1. Reviewer viewing full `content` of every source — acceptable (a reviewer must see sources to validate); no redaction this slice.
2. `link` kind: whether to validate `content` is a URL — spec keeps it free text (a link may carry a label + URL); no URL validation this slice.
3. Source list preview length (truncate `content` to ~N chars in the row) — plan picks a value.
