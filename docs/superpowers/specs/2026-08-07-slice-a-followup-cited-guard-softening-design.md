# Slice A follow-up — Soften the cited-source guard (fix the deadlock) — Design

**Status:** Approved direction (2026-08-07), spec for review. Follow-up to Slice A (source editability,
PR #381). Prompted by a local-test finding ([[feedback_cited_guard_deadlock]]).

## Problem

Slice A's guard hard-blocks editing/deleting a source cited by **any** artifact version, with an
**unactionable** message and **no escape hatch** — a **deadlock**:

- Verified in a live local test: a YouTube-link Input was cited by an **unvalidated** `book` draft
  ("Music at 60+", 5 of 6 sections). The content-edit returned 409 *"remove the citation in the
  draft"* — but there is no affordance to remove a citation, and the user can't un-cite without
  editing/regenerating the draft, which still cites the source (it's in Input) — while the source is
  locked. So a bad/unwanted source gets stuck exactly when the author most needs to fix it.
- The guard *logic* is correct (the source really is cited); the *policy* is too strict — it protects
  provenance that isn't yet trust evidence (an unvalidated draft), and its message points nowhere.

## Goal

Block only where provenance is genuinely immutable — a **validated** (approved) citing version —
and make that block **actionable**. Allow edit/delete when a source is cited **only by unvalidated
drafts** (breaking the deadlock).

## Locked policy (approved direction)

For an input on a `PATCH content` or `DELETE`:
- **Cited by a currently-VALIDATED version** → **409, actionable message** naming the version and the
  real next step: *"This source is cited by an approved draft (v{n}). Unapprove it first to edit or
  remove the source."* (Unapprove already exists — `POST /versions/{id}/approvals/withdraw`.)
- **Cited only by UNVALIDATED draft versions** (or not cited) → **allowed.** Those drafts are not
  trust evidence; regenerating replaces them.
- **Title / source_ref edits** → always allowed (unchanged from Slice A).

"Validated" = the version's latest `approval` row is an active approve (the slice-2 toggle: latest
`approval.action == 'approve'`), the same rule that drives `is_validated` in `GET /projects/{id}`.

## Non-goals (this follow-up)

- A per-section "remove this citation" editor (that's the draft-editing surface, Slice C territory).
- Auto-regenerating or auto-editing affected drafts.
- **Stale-marking** the affected unvalidated drafts is an **optional enhancement, deferred** (see
  below) — not required to fix the deadlock.

## Architecture

### Backend (`backend/src/trust/`)

- **Replace `input_cited`** with `input_cited_by_validated(conn, *, project_id, input_id) -> bool`:
  true iff some artifact_version of the project (a) cites the input in
  `content.sections[].source_ids` AND (b) is currently validated (its latest approval action is
  `approve`). Implementation: the existing jsonb-containment query to find citing versions, joined to
  a "latest approval is approve" check per version (a correlated subquery on `approval` ordered by
  `seq DESC LIMIT 1`, or resolve candidate versions and check `approval_repo.get_approval` in
  Python — correctness over cleverness; decide in the plan).
- **`edit_project_input` / `delete_project_input`:** call `input_cited_by_validated` instead of
  `input_cited`. On true → 409 with the actionable message above (delete-flavoured / edit-flavoured).
  On false → proceed. Title-only edits still skip the check entirely (content is `None`).
- Keep the un-cited and only-unvalidated-cited paths fast.

### Mobile (`mobile/app/trust/[projectId].tsx`)

- **Message:** the 409 handler already shows `ApiError.userMessage()` — the backend now returns the
  actionable text, so no client logic change is strictly required. Optionally: when the guard blocks,
  offer a shortcut to the draft/Feedback tab so the user can Unapprove.
- **Optional pre-confirm (nice-to-have):** before a content-edit/delete of a source that *is* cited by
  an unvalidated draft, show a confirm: *"This source is used by a draft — editing it changes what
  that draft is grounded on. Continue?"* Requires knowing the citing drafts client-side; since the
  project detail carries only version summaries (no content), this needs a small
  `GET /trust/inputs/{id}/citations` → `[{version_id, artifact_title, version_no, is_validated}]`.
  **Deferred** unless we want the naming — the core fix (allow + the backend's actionable 409) does
  not need it.

## Deferred enhancement — stale marking

When a source cited by an unvalidated draft is edited/deleted, that draft's grounding drifts. A
future refinement: mark the affected versions "source changed" (e.g. a `sources_changed_at` column or
a computed badge) and surface *"a source changed since this draft — regenerate to refresh."* Not in
this follow-up (adds a migration + UI); recorded so we don't lose it.

## Testing

**Backend (pytest):**
- Source cited only by an **unvalidated** draft → `PATCH content` and `DELETE` **succeed** (200 / 204).
- Source cited by a **validated** (approved) version → `PATCH content` and `DELETE` **409** with the
  actionable message; **title** edit still 200.
- After **Unapprove** (withdraw) the citing version → the same source's content-edit/delete now
  **succeed** (proves the escape hatch).
- Un-cited source → edit/delete succeed (regression).
- Owner-only + 404 unchanged.

**Mobile:** existing sources-edit tests still pass; if the pre-confirm/citations endpoint is built,
add coverage — else no new mobile test required (backend behaviour change only).

## Files

**Backend**
- `src/trust/project_repo.py` — `input_cited_by_validated` (replaces `input_cited`).
- `src/trust/router.py` — the two guard call sites + the actionable 409 messages.
- Tests: `backend/tests/test_trust_router.py`.

**Mobile** — none required for the core fix (backend message change). Optional: citations endpoint +
pre-confirm (deferred).

## Rollout

Backend-only behaviour change (no migration, no new route unless the optional citations endpoint is
built). **Prod backend refresh on ship.** No web redeploy needed for the core fix (the message comes
from the backend), but redeploy if any mobile copy/shortcut is added.
