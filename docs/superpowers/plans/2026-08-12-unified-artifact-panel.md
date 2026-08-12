# Unified artifact panel (whole-book) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the whole-book draft-version screen into one coherent, role-aware panel: reviewer
leaves a *note*, owner has one primary **Revise → new version** (+ secondary Edit), can **Revise
from a reviewer note**, and sees **inline version history** — resolving the Edit-vs-Regenerate
confusion.

**Architecture:** All changes in `mobile/app/trust/version/[versionId].tsx`, reusing existing hooks
(`generateVersion`, `addVersion`, `addFeedback`, `approve`/`unapprove`) and state (`isOwner`, `regen`,
`guidance`, `version`, `project`). No backend change.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-unified-artifact-panel-design.md`.
- **Mobile-only. No backend/schema/migration/generation-behavior change.** Reuse existing hooks only.
- **Honor roles:** `isOwner = project?.my_role === "owner"`. Owner generates; reviewer only notes.
- All 3 tasks edit the SAME file → run implementers **sequentially** (a task reviewer may run
  parallel with the next implementer; never two implementers at once).
- Read `project`/`version` **defensively** (may be null / one version / missing fields — no throw).
- `useThemedStyles`; reuse existing styles/primitives; **NO color-literal test asserts**.
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/app/trust/version/[versionId].tsx` — the whole-book version panel (all tasks)
- Tests: extend the existing version-screen test under `mobile/__tests__/`

Verified anchors (current file):
- `isOwner = project?.my_role === "owner"` (line 43). Params `versionId`, `artifactId`, `projectId`
  from `useLocalSearchParams` (22-24).
- Actions row (264-287): `Copy` | `Edit`(owner, `startEdit`) | `Regenerate`(owner, `openRegen`) |
  `Approve`/`Unapprove`. The revise mechanism = `openRegen()` → sets `regen=true` → a guidance
  `TextInput` bound to `guidance` → `generateVersion(String(artifactId), { guidance })` (regen submit
  ~line 136).
- Revision-notes block (406-440): renders `version.feedback` list (412-421) + a `noteBody` TextInput
  with placeholder "Request a revision…" and an `onAddFeedback` button (422-439) — currently shown to
  **everyone** (no role gate).
- Sibling versions: `project.artifacts` (`ArtifactDetailView[]` = `{artifact, versions}`); find the
  artifact whose `artifact.id === artifactId`, use its `versions` (`VersionSummaryView[]`:
  `id, version_no, created_at, is_validated, recorded_via`).
- Navigate to another version (mirror DraftsPanel `[projectId].tsx:1251`):
  `router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId, projectId } })`.

---

### Task 1: Role-aware revise model (relabel + gate)

**Files:** Modify `mobile/app/trust/version/[versionId].tsx`; extend its test.

- [ ] **Step 1: Write the failing test** (extend the version-screen test):
  - Render as **owner** (`my_role: "owner"`): a control labeled **"Revise"** (accessibilityLabel
    "Revise draft") is present; the note-input box (placeholder "Request a revision…") is **absent**;
    a secondary "Edit text"/"Edit" control is present.
  - Render as **reviewer** (`my_role: "reviewer"`): the note box "Request a revision…" **is** present;
    no "Revise"/"Edit" control.
  Follow the file's existing render/mock seam (mock `useTrustProject`/`getVersion`). No color literals.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement.**
  - **Relabel the revise action:** change the owner "Regenerate" button (274-276) text +
    `accessibilityLabel` to **"Revise"** ("Revise draft"); present it as the **primary** action
    (reuse an existing primary/`saveBtn`-style or the approve emphasis — no new color literals), and
    keep "Edit" (269-271) as **secondary** (relabel to "Edit text" for clarity). Keep `openRegen`/the
    `regen` guidance box and its `generateVersion` submit unchanged. (Update the regen box heading
    copy if it says "Regenerate" → "Revise — describe the change; this creates a new version.")
  - **Gate the note box to reviewers:** wrap the `noteBody` TextInput + `onAddFeedback` button
    (422-439) in `{!isOwner ? ( … ) : null}`, and add helper copy under the title for reviewers:
    "Leaves a note for the owner — they'll revise the draft." The **feedback list** (412-421) stays
    visible to everyone. Adjust the empty-state (410) so owners don't see "Ask for a change below"
    (e.g. owners: "No revision notes yet."; reviewers keep the ask copy).
  - Do NOT change approve/withdraw, Copy, edit-save, or the render preview.

- [ ] **Step 4: Run** — `cd mobile && npx jest <version test> && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__
git commit -m "feat(trust): role-aware revise — owner Revise (primary) + Edit (secondary), reviewer note"
```

---

### Task 2: Revise from a reviewer note (owner)

**Files:** Modify `mobile/app/trust/version/[versionId].tsx`; extend its test. Depends on T1.

- [ ] **Step 1: Write the failing test** — as **owner**, a feedback row (seed `version.feedback`
  with one note) shows a "Revise from this note" control; pressing it opens the revise/guidance box
  with the note body prefilled (assert the guidance TextInput's value contains the note text), and
  submitting calls `generateVersion` (mock) with that guidance. Reviewer does NOT see the control.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement.** In the feedback-list row (412-419), for `isOwner`, add a small
  "Revise from this note" `Pressable` (accessibilityLabel `Revise from this note`) whose onPress:
  `setGuidance(f.body); openRegen();` (prefills the existing `guidance` state and opens the existing
  revise box — the existing `generateVersion` submit then uses it). Reuse a secondary/link style; no
  new color literals. Reviewer rows show no such control.

- [ ] **Step 4: Run** — `cd mobile && npx jest <version test> && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__
git commit -m "feat(trust): owner can Revise from a reviewer's note (prefills guidance)"
```

---

### Task 3: Inline version history

**Files:** Modify `mobile/app/trust/version/[versionId].tsx`; extend its test. Independent of T1/T2
(but same file → runs after them).

- [ ] **Step 1: Write the failing test** — with `project.artifacts` containing the current artifact
  with **two** versions, a history section renders both `v{n}` entries, marks the current one, and
  tapping the other calls `router.push` with `{ pathname: "/trust/version/[versionId]", params: {
  versionId: <other id>, artifactId, projectId } }` (mock `useRouter`). With one version (or no
  matching artifact) → no history block (query returns null), no crash.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement.** Derive `const versions = (project?.artifacts ?? []).find(a =>
  a.artifact.id === artifactId)?.versions ?? [];`. When `versions.length > 1`, render a "Versions"
  block (place it above the Back button): a row per version — `v{version_no}`, localized
  `created_at` date, a `✓` when `is_validated`, and a "current" marker when `v.id === versionId`.
  Non-current rows are a `Pressable` navigating via
  `router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId, projectId } })`.
  Reuse existing note/row styles; no new color literals. Guard everything defensively (null project,
  missing artifact).

- [ ] **Step 4: Run** — `cd mobile && npx jest <version test> && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__
git commit -m "feat(trust): inline version history on the draft panel"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] No backend/other-screen touched (grep the diff: only `version/[versionId].tsx` + tests).
- [ ] **Web screenshot verify** (local expo web + stub `getVersion`/project + dev-token patch, per
  the 08-11 pin): owner sees Revise (primary) + Edit (secondary), no note box, a "Revise from this
  note" on a seeded feedback row, and a version-history list; reviewer sees the "Request a revision"
  note box and no Revise/Edit.
- [ ] PR body: unified whole-book artifact panel (role-aware revise + revise-from-note + inline
  history); adapts the Lovable panel; mobile-only → web redeploy, no backend.

## Self-Review

- **Spec coverage:** revise relabel/gating (T1) · revise-from-note (T2) · inline history (T3).
  Per-topic/backend/per-row-notes correctly out of scope.
- **Type consistency:** history reads `ArtifactDetailView.versions` (`VersionSummaryView`); nav params
  match the route's `useLocalSearchParams` shape; `generateVersion(artifactId, {guidance})` unchanged.
- **Constraints:** mobile-only; role-gated; defensive reads; reuse hooks/styles; no color-literal
  asserts.
