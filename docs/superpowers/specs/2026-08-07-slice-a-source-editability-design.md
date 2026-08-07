# Slice A — Source view / edit / delete (Projects Input) — Design

**Status:** Approved (brainstorming, 2026-08-07). First slice of the Projects TOC-structure arc
(`docs/superpowers/specs/2026-08-07-projects-toc-structure-arc-design.md`). Standalone — ships on its
own; fixes Sridhar's #1 ([[feedback_sridhar_testrun_2026-08-07]]).

## Problem

Project sources (Input tab) are **write-only** — confirmed both layers:
- Backend `backend/src/trust/router.py`: only `POST /projects/{id}/inputs`. No update, no delete;
  `project_repo` has only `add_input` + `list_inputs`.
- Mobile `SourcesPanel` (`mobile/app/trust/[projectId].tsx`): each source renders as a static row
  (kind + an 80-char preview + date) — no view-full, no edit, no delete. A Link shows only its title.

So an author who adds a wrong/incomplete source cannot fix or remove it.

## Goal

On the Input/Sources list (owner only): **view the full source**, **edit** it (title / content /
source_ref), and **delete** it — with a guard so a source that a validated draft was grounded on
can't be silently removed or have its content changed out from under that draft.

## Non-goals

- The Structure/TOC phase, Suggest-outline, per-topic anything (Slices B–D).
- Changing a source's `kind` (transcript/note/link) — edit keeps the kind; to change kind, delete +
  re-add. (Kind drives nothing downstream today; not worth the churn.)
- Reviewer editing — sources are the **owner's** raw material; reviewers see them read-only.

## The "cited by a version" guard (important)

A source cited by a generated draft is provenance: deleting it, or editing its **content**, would
break what a validated draft was grounded on. So:
- **Delete** an input that is cited by ANY artifact version → **blocked** (409) with a clear message.
- **Edit content** of a cited input → **blocked** (409) with the same message (editing *title* or
  *source_ref* is allowed even when cited — they don't change the grounded text).
- An **un-cited** input → freely edit/delete.

**Where "cited" lives:** NOT the `artifact_version_source` join table — it exists but is **never
populated** (`generate_version` doesn't call `add_version_sources`). The real citation is in
`artifact_version.content.sections[].source_ids` (input UUIDs). So the guard scans that JSON across
the project's versions. (Follow-up, out of scope: populate `artifact_version_source` on generate so
this becomes a clean join — noted in the arc doc.)

## Architecture

### Backend (`backend/src/trust/`)

**1. Repo (`project_repo.py`):**
- `update_input(conn, *, input_id, title, content, source_ref) -> ProjectInput` — `UPDATE
  project_input SET title=$, content=$, source_ref=$ WHERE id=$ RETURNING {_I}`. (content_hash /
  storage_path are unused/null today — leave them.)
- `delete_input(conn, *, input_id) -> None` — `DELETE FROM project_input WHERE id=$1`.
- `get_input(conn, *, input_id) -> ProjectInput | None` — for the guard/access to resolve project.
- Citation check (new, in `project_repo` or `artifact_repo`):
  `input_cited(conn, *, project_id, input_id) -> bool` — true if any artifact_version of the
  project has a section citing this input id. SQL (jsonb containment):
  ```sql
  SELECT EXISTS (
    SELECT 1 FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id
    WHERE a.project_id = $1
      AND v.content -> 'sections' @> jsonb_build_array(jsonb_build_object('source_ids', jsonb_build_array($2::text)))
  )
  ```
  (If the containment form is brittle across content shapes, fall back to loading the project's
  versions and checking `input_id in section.source_ids` in Python — correctness over cleverness;
  decide in the plan.)

**2. Endpoints (`router.py`, both owner-only via `_require_role(..., need_owner=True)`; resolve the
input's project for the guard):**
- `PATCH /api/v1/trust/inputs/{input_id}` — body `ProjectInputUpdateIn { title?, content?, source_ref? }`.
  Load the input (404 if gone) → owner check on its project. If `content` is being changed AND
  `input_cited` → **409** "This source is cited by a draft — remove it from the draft first, or edit
  the draft instead." Else `update_input` → `ProjectInputOut`.
- `DELETE /api/v1/trust/inputs/{input_id}` — load (404) → owner check → if `input_cited` → **409**
  (same message, delete-flavoured) → else `delete_input` → 204.
- (Routes are keyed by `input_id` alone, resolving project from the row, matching how
  `/versions/{id}` resolves its project. Add a `project_id_for_input` helper in `access.py` or
  resolve via `get_input`.)

**3. Schemas (`schemas.py`):** `ProjectInputUpdateIn { title: str | None; content: str | None
(<=200_000); source_ref: str | None }`. Reuse `ProjectInputOut`.

### Mobile (`mobile/app/trust/[projectId].tsx` + client/hook)

- `trustClient`: `updateInput(inputId, body, token)` (PATCH), `deleteInput(inputId, token)` (DELETE).
- `useTrustProject`: `editInput(inputId, body)` and `removeInput(inputId)` → call the client then
  `refresh()`. (There's already `addInput`.)
- **SourcesPanel** (owner): make each source row tappable → open a **source detail sheet/modal**
  showing the full `content` (not the 80-char preview) + `kind`/`title`/`source_ref`, with:
  - **Edit** → an editable form (title, content multiline, source_ref) → Save → `editInput`.
  - **Delete** → confirm (`@/lib/alert`) → `removeInput`.
  - A cited-guard **409** → show the friendly message (don't crash); leave the source intact.
  - Reviewers: row opens the detail **read-only** (no Edit/Delete).
- Keep the existing "Add source" form + list layout; this adds the per-row detail/edit/delete.

## Data flow

```
Sources row tap → detail sheet (full content)
  Edit → editInput(id, {title, content, source_ref}) → PATCH /inputs/{id}
        → 409 if content-edit on a cited source → show message, keep source
        → else updated → refresh
  Delete → confirm → removeInput(id) → DELETE /inputs/{id}
        → 409 if cited → show message → else 204 → refresh
```

## Error handling

- 404 (input gone) → "That source no longer exists." + refresh.
- 409 (cited) → the friendly guard message; the source stays.
- 403 (not owner) → shouldn't be reachable (reviewers get read-only UI), but handle defensively.

## Testing

**Backend (pytest, DB):**
- `PATCH` title/source_ref on an un-cited input → 200, persisted; `list_inputs` reflects it.
- `PATCH content` on an **un-cited** input → 200; on a **cited** input → **409**, content unchanged.
- `PATCH title` on a **cited** input → 200 (title allowed even when cited).
- `DELETE` un-cited → 204, gone from `list_inputs`; `DELETE` cited → **409**, still present.
- Non-owner (reviewer) `PATCH`/`DELETE` → 403.
- Unknown input id → 404.
- `input_cited` true when a version's `content.sections[].source_ids` contains the id, false otherwise.

**Mobile (Jest + RNTL):**
- Owner: tapping a source row opens the detail with full content; Edit → `updateInput` called with
  the edited fields; Delete (confirm) → `deleteInput` called.
- A mocked 409 on delete/edit shows the guard message and does NOT remove the row.
- Reviewer (`my_role !== "owner"`): the row opens read-only — no Edit/Delete controls.

## Files

**Backend**
- `src/trust/project_repo.py` — `update_input`, `delete_input`, `get_input`, `input_cited`.
- `src/trust/access.py` — `project_id_for_input` (or resolve via `get_input`).
- `src/trust/router.py` — `PATCH`/`DELETE /inputs/{input_id}`.
- `src/trust/schemas.py` — `ProjectInputUpdateIn`.
- Tests: `backend/tests/test_trust_router.py` (+ repo test if warranted).

**Mobile**
- `src/api/trustClient.ts` — `updateInput`, `deleteInput`.
- `src/hooks/useTrustProject.ts` — `editInput`, `removeInput`.
- `app/trust/[projectId].tsx` — SourcesPanel row → detail/edit/delete (owner), read-only (reviewer).
- Tests under `mobile/__tests__/`.

## Rollout

Backend adds endpoints (no migration — `project_input` already has the columns). **Prod backend must
be refreshed on ship** (new routes) or PATCH/DELETE 404 on prod. Web redeploy for the UI.
