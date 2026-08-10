# Draft version provenance + action labels — Design

**Status:** Approved (brainstorming, 2026-08-10). Addresses a user-reported confusion: whole-book
drafts "always show v1." Not a bug — the confusion is that the UI doesn't distinguish **starting a
new draft** (a new artifact → v1) from **regenerating an existing draft** (a new version →
increment), and doesn't show **what each version was generated from**. Related:
[[feedback_real_gap_is_wayfinding]].

## Problem

In the whole-book Drafts phase (`trust/[projectId].tsx`, `mode === "whole"`):
- The **"Generate" format grid** creates a NEW artifact per press (`generateFormat` → `createArtifact`
  + first version) → each is **v1**. This is "start a new draft," but the label "Generate" reads like
  it should be re-versioning, so repeated presses look like "the version counter is broken."
- Regenerating an EXISTING draft (the per-artifact / in-version "Regenerate") correctly increments
  (v2, v3…) — but the user couldn't tell the two actions apart.
- Nothing shows **what a given version was built from** (which sources, whether guidance was used), so
  drafts are hard to tell apart and "v1 again" has no explanation.

Per-topic works the same way (reuses the topic → increments) and was understood — this is whole-book-
specific wayfinding.

## Goal

Make the versioning model legible with two small, mostly-copy changes: (1) a **provenance line** on
the open draft version screen, and (2) **clearer action labels** distinguishing "start a new draft"
from "regenerate."

## Locked decisions (brainstorming 2026-08-10)

1. **Provenance line on the version screen only** (`trust/version/[versionId].tsx`). The data
   (`generation_meta`) is already returned on `VersionDetailView` — **mobile-only, no backend**.
   (Showing it in the Drafts list too was deferred — it would need a backend field on the version
   summary.)
2. **Relabel the whole-book "Generate" format grid → "Start a new draft"** with a one-line hint, so it
   reads as distinct from "Regenerate" (which adds a version). Copy-only.

## Architecture

### 1. Provenance line — `trust/version/[versionId].tsx`

Under the `v{version_no}` title, render a muted line derived from `version.generation_meta` (type
`Record<string, unknown> | null`):
- `source_input_ids: string[]` → `"Generated from {n} source{s}"` (0/absent → "Generated draft").
- `guidance` (non-empty string present) → append `" · with your guidance"`.
- Read defensively (older versions / null meta): a tiny pure helper
  `describeProvenance(meta): string` that guards every field (never throws on a missing/oddly-typed
  field). Keep it in a small lib (e.g. `mobile/src/lib/draftProvenance.ts`) so it's unit-testable.
- Style: reuse the existing muted caption style (or a `<Label tone="muted">`); no new color literals.

### 2. Action labels — `trust/[projectId].tsx` (whole mode)

- The whole-mode Generate block (`<Text style={styles.artifactTitle}>Generate</Text>` + the format
  grid): change the heading to **"Start a new draft"** and add a one-line hint below it:
  *"Creates a fresh draft (v1). To make a new version of an existing draft, open it and Regenerate."*
  Update the format cards' `accessibilityLabel` from `Generate {label}` to `Start a new {label} draft`
  (keep the card's visible `{f.label}` + `+` as-is).
- Add a short section header above the existing artifacts list (the `artifacts.map`) — e.g.
  **"Your drafts"** — so the list of artifacts-with-versions is visually separated from the
  new-draft grid. (Reuse an existing heading style.)
- Do NOT change the per-artifact/in-version "Regenerate" (it already increments correctly), the
  per-topic mode, or any generation behavior. Copy/label + one helper only.

## Testing

- **`describeProvenance` (unit):** `{ source_input_ids: ["a","b","c"] }` → contains "3 sources";
  `{ source_input_ids: ["a"], guidance: "focus on X" }` → "1 source" + "with your guidance"; `{}` /
  `null` → a sane fallback string, no throw; a malformed `source_input_ids` (non-array) → no throw.
- **Version screen:** the provenance line renders under the title for a version whose
  `generation_meta` has sources (assert the text via `getByText`/substring); a null-meta version
  still renders (fallback, no crash). No color-literal asserts; approve/withdraw/notes/edit
  assertions unchanged.
- **`[projectId]` whole mode:** the new-draft heading reads "Start a new draft" + the hint text is
  present; the format cards' accessibilityLabel updated; the "Your drafts" header renders above the
  artifacts list; per-topic mode + generation behavior unchanged (existing tests stay green).

## Files

- Create: `mobile/src/lib/draftProvenance.ts` (`describeProvenance`)
- Modify: `mobile/app/trust/version/[versionId].tsx` (provenance line under the title)
- Modify: `mobile/app/trust/[projectId].tsx` (whole-mode labels + "Your drafts" header)
- Tests under `mobile/__tests__/`

## Decomposition (SDD)

- **T1 — provenance line:** `draftProvenance.ts` helper + render it on the version screen. Tests.
- **T2 — action labels:** whole-mode "Start a new draft" + hint + "Your drafts" header + card
  accessibilityLabels. Tests.

## Rollout

Mobile-only → **web redeploy**, no backend, no migration.

## Out of scope

- Provenance in the Drafts LIST / per-version-row (deferred — needs a backend summary field).
- Input-source versioning / staleness (#3 — the deeper "Input as a versioned thing" model; separate).
- Any change to generation behavior, the per-artifact/in-version Regenerate, or per-topic.

## Global constraints

Copy/label + one pure helper only — NO generation-behavior change. Read `generation_meta`
defensively (older/null metas must not crash). `useThemedStyles`; reuse existing muted/heading styles;
NO color-literal test asserts. `npx tsc --noEmit` clean + full `npx jest` green.
