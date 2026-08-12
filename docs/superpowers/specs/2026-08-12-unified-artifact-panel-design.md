# Unified artifact panel (whole-book) — Design

**Status:** Approved (brainstorming, 2026-08-12). Adapts the tight single-panel draft screen from
Sridhar's Lovable UX prototype ([[project_lovable_ux_teardown]]) onto our whole-book draft-version
screen, resolving Sridhar's "Regenerate vs Edit unclear" + "Draft tab lacks what-to-do" friction
([[feedback_sridhar_testrun_2026-08-07]]). Second flow slice after the guided first-draft banner
(PR #411).

## Problem

`mobile/app/trust/version/[versionId].tsx` already shows the draft body, approve/withdraw, an
edit-and-regenerate pair, and a feedback box — but the model is confusing:

- **"Request a revision" is mislabeled.** It calls `addFeedback`, which files a *note only* — it does
  NOT create a new version. Lovable's same-named control produces a version.
- **Three overlapping revise actions**: **Edit** (manual → new version via `addVersion`),
  **Regenerate** (guidance → new version via `generateVersion`), **Request a revision** (a note, no
  version). This is the reported "Edit vs Regenerate unclear."
- **No inline version history** — switching versions means bouncing back to the Drafts list.
- Our **roles** must be honored (Lovable is single-user): a **reviewer** can leave feedback but
  cannot generate; only the **owner** generates.

## Goal

Make the panel answer, in one place: *what is this draft, what changed, and what do I do* — with one
clear action per role. Mobile-only, **no backend change** (reuses existing hooks).

## Locked decisions (brainstorming 2026-08-12)

1. **Role-aware collapse of the revise actions:**
   - **Reviewer** → a **"Request a revision"** box that files a **note** for the owner (today's
     `addFeedback`) — labeled honestly as a note, not a version.
   - **Owner** → one primary **"Revise → new version"** (opens a guidance box; free-text OR prefilled
     from a selected reviewer note) → `generateVersion({ guidance })` (guidance rides into
     `generation_meta` provenance). Manual **"Edit text"** stays but is clearly **secondary**.
2. **Inline version history** — list the artifact's sibling versions (`v#` · date · `✓` validated ·
   *current*), tap to open. **Per-row revision-note text is DEFERRED** (needs a backend summary field
   — same gap as the parked "provenance in the Drafts list").
3. **Scope = the whole-book screen only** (`version/[versionId].tsx`). Per-topic viewer aligned later.

## Architecture

All in `mobile/app/trust/version/[versionId].tsx` (reuses existing state/hooks — `isOwner`,
`generateVersion`, `addVersion`, `approve`/`unapprove`, `addFeedback`, `project`, `version`):

### 1. Owner revise model (relabel + reprioritize — the existing controls already do the work)
- The existing **Regenerate** control (opens the `guidance` box → `generateVersion`) becomes the
  **primary "Revise"** action; relabel button/copy accordingly (guidance box heading e.g. "Revise —
  describe the change; a new version is created").
- The existing manual **Edit** control (→ `addVersion`) stays, presented as **secondary** ("Edit text
  manually").
- Remove/deprecate the misleading owner-facing "Request a revision" note box (owner's revise path is
  Revise). Owner still *reads* the feedback thread.

### 2. Reviewer note (keep, label honestly)
- For a **reviewer** (`!isOwner`), keep the `addFeedback` box, titled **"Request a revision"** with
  helper copy "Leaves a note for the owner — they'll revise the draft." (No version created.)

### 3. Revise-from-a-note (owner)
- Each feedback row (`version.feedback: FeedbackView[]`) gets an **owner-only** "Revise from this
  note" affordance that **prefills the `guidance` state** with the note body and opens the Revise
  box, then `generateVersion({ guidance })` as normal. No backend change — `generateVersion` already
  takes `guidance`.

### 4. Inline version history
- Derive sibling versions from the loaded project: find the artifact by the `artifactId` route param
  in `project.artifacts` → its `versions` (`VersionSummaryView[]`: `version_no`, `created_at`,
  `is_validated`, `recorded_via`). Render a compact list: `v{n}` · date · `✓` when `is_validated` ·
  a *current* marker for the open `versionId`. Tapping a row navigates to that version (same route,
  new `versionId`/`artifactId`/`projectId` params — mirror how the Drafts list navigates).
- If the project/artifact isn't loaded yet or has one version, render nothing (defensive).

### Roles / gating summary
- **Owner:** Revise (primary) · Edit text (secondary) · Approve/record-on-behalf · Withdraw · reads
  feedback thread · Revise-from-note · history.
- **Reviewer:** Request a revision (note) · Approve (self) / Withdraw · reads feedback thread ·
  history. No Revise/Edit (can't generate).

## Testing

- **Owner** sees a primary **"Revise"** (opens guidance → `generateVersion`) and a secondary **"Edit
  text"**; does NOT see a note-filing "Request a revision" box.
- **Reviewer** sees **"Request a revision"** (→ `addFeedback`, note only) and does NOT see
  Revise/Edit.
- **Revise-from-note**: owner tapping a feedback row's "Revise from this note" prefills the guidance
  box with the note body; submitting calls `generateVersion` with that guidance.
- **History** lists sibling versions with `v#`/validated marker; the current version is marked;
  tapping another navigates. One-version/empty → no history block, no crash.
- Approve/withdraw and the render preview are unchanged (existing tests stay green).
- No color-literal asserts; `useThemedStyles`; existing primitives.

## Files

- Modify: `mobile/app/trust/version/[versionId].tsx`
- Tests under `mobile/__tests__/` (extend the existing version-screen test).

## Decomposition (SDD)

- **T1 — revise model relabel/reprioritize + reviewer/owner gating** (primary Revise + secondary
  Edit; reviewer-only note box honestly labeled; remove owner note box). Tests.
- **T2 — Revise-from-a-note** (owner affordance on feedback rows → prefill guidance → generate).
  Tests. Depends on T1.
- **T3 — inline version history** (sibling-versions list + tap-nav). Tests. Independent of T1/T2.

## Rollout

Mobile-only → **web redeploy**, no backend, no migration.

## Out of scope

- Per-topic viewer (`topic-version/[id].tsx`), the Drafts list, generation behavior, backend.
- Per-row revision-note text in history (deferred — needs a backend version-summary field).
- Publish/Feedback-tab rollup (later flow slices).

## Global constraints

Mobile-only, no backend/generation change. Honor owner vs reviewer roles. Reuse existing hooks
(`generateVersion`, `addVersion`, `addFeedback`, `approve`/`unapprove`) — no new endpoints. Read
`project`/`version` defensively. `useThemedStyles`; reuse existing primitives; **no color-literal
test asserts**. `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
