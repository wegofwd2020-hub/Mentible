# Version View Affordance, Timestamps + Compare — Design

**Status:** Approved (brainstorming, 2026-08-04)
**Context:** ADR-037 trust Project workspace. Follows the Lovable-IA arc (Input · Drafts · Feedback ·
Publish, all shipped). Companion: PR #370 draft viewer (`app/trust/version/[versionId].tsx`).

## Problem

On prod, the version lists (Drafts + Feedback panels of `app/trust/[projectId].tsx`) show multiple
versions but users can't tell they're openable. The rows *are* full-row `Pressable`s that push the
#370 viewer, but they render as plain status text (`v1 … Awaiting review` / `Review →` /
`Validated ✓`) with **no button affordance** — nobody discovers the tap. There is also no way to
**compare** two versions, and rows show **no date/time** to tell versions apart.

## Goal

1. Make viewing a version **discoverable** — an explicit `View` control on every version row, in both
   panels, for every status.
2. Show each version's **date + time** in the list.
3. Add **Compare** — pick 2 versions of one artifact → responsive side-by-side view with changed
   sections highlighted.

## Non-goals

- Word-level inline diff (section-level highlight only; word-level is a future enhancement).
- Editing/regenerating from the compare screen.
- Cross-artifact compare (only versions of the SAME artifact are comparable).
- Any backend change — `getVersion` already returns full content; `VersionSummaryView` already has
  `created_at`.

## Data already available

- `VersionSummaryView { id, version_no, created_at, is_validated, recorded_via }` (in the project
  detail) — `created_at` drives the timestamp.
- `getVersion(versionId)` → `VersionDetailView { …, content: { sections: DraftSection[] }, … }` —
  drives the compare panes.

## Theme note

ADR-038 forced-navy was reversed (#375–377): SME surfaces follow the **selected** theme. The new
compare screen uses `useThemedStyles(makeStyles)` with the ambient theme — do **not** wrap it in a
forced `SmeThemeScope`.

## Architecture

### Part A — View affordance + timestamps (mobile, `app/trust/[projectId].tsx`)

Both `DraftsPanel` and `FeedbackPanel` version rows change from bare status text to a clear row with:
- `v{version_no}` + a formatted **`created_at`** (date + time, e.g. `Aug 4, 2:14 PM`).
- the existing status (`Validated ✓` + `recorded_via` chip, or `Awaiting review`).
- an explicit **`View`** affordance (a small button/chevron labelled "View", `accessibilityLabel`
  stays `Open version {n}`), visually reading as tappable.

Keep the whole-row `Pressable` → `onOpenVersion` (unchanged wiring). In Feedback, `View`, `Approve`,
and `Unapprove` remain **separate** sibling tap targets (don't nest). Add a shared date-format
helper (extend the existing `sourceDate`, or a new `versionTimestamp(created_at)` → date+time;
returns "" on null/invalid).

### Part B — Compare selection (mobile, `app/trust/[projectId].tsx`)

Per artifact, below its version list, a **`Compare…`** control (owner + reviewer — anyone who can
view can compare). Tapping it enters **compare mode** for that artifact:
- each row shows a checkbox; the user selects exactly **2**; a `Compare (2)` button activates only at
  2 selected (selecting a 3rd is prevented or replaces the oldest — pick one rule: **cap at 2, block
  further** with the button disabled until exactly 2).
- `Compare` → `router.push({ pathname: "/trust/compare/[versionId]", params: { versionId: aId, b: bId, artifactId, projectId }})` (path param carries A; `b` carries B — a dynamic route needs one path segment).
- A `Cancel`/toggle exits compare mode.

State: `compareArtifactId: string | null` (which artifact is in compare mode) + `compareSel: string[]`
(selected version ids). Only one artifact in compare mode at a time.

### Part C — Compare screen (new `mobile/app/trust/compare/[versionId].tsx`)

- Params: `versionId` (A), `b` (B), `artifactId`, `projectId`.
- Fetches both via `getVersion(A)` + `getVersion(B)` (parallel); loading spinner; friendly error if
  either 404/403 (reuse the viewer's error copy).
- Uses `useTrustProject(projectId)` for `project.inputs` → the `S1..Sn` citation labels (same
  mapping the viewer uses), and to title the header (`artifact.title ?? format`).
- **Header:** `v{A} · {ts} ↔ v{B} · {ts}`, each with its validated/`recorded_via` badge.
- **Layout:** `useWindowDimensions().width >= 700` → **two columns** (A | B); else **stacked**
  (A block, then B block). A shared `SECTION_BREAKPOINT = 700`.
- **Alignment + highlight:** align sections by **index** `i` (0..max(lenA,lenB)-1). For each index:
  - both present: render both; if `A[i].heading !== B[i].heading || A[i].body !== B[i].body` → tint
    both as **changed**.
  - only A present → A tinted **removed**, B side shows an empty "— no section —" placeholder.
  - only B present → B tinted **added**, A side placeholder.
  - Section renders heading + body + citation chips (reuse the viewer's section styling).
- Tints come from the theme palette (e.g. a subtle warning/growth/neutral background), theme-aware.
- Read-only. A `Back` control returns to the workspace.

## Data flow

```
Drafts/Feedback tab → Compare… (artifact X) → compare mode
  → check v2, check v3 → Compare
  → push /trust/compare/v2?b=v3&artifactId=X&projectId=P
  → getVersion(v2) + getVersion(v3)
  → align sections by index → side-by-side (web) / stacked (mobile), changed tinted
```

## Error handling

- Compare button disabled unless exactly 2 selected.
- Compare screen: either fetch fails → inline "This version no longer exists." / access error; a
  `Back` to recover. Never a blank screen (apply the #370 content-shape guard: `(content?.sections ?? [])`).

## Testing

**Mobile (Jest + RNTL):**
- Version row renders `v{n}`, a formatted timestamp, and a `View` control; tapping View (or the row)
  calls `onOpenVersion(artifactId, versionId)`.
- `versionTimestamp(null)` → "" ; a valid ISO → a non-empty date+time string.
- Compare mode: `Compare…` reveals checkboxes; the `Compare` button is disabled until exactly 2
  selected; pressing it pushes `/trust/compare/[versionId]` with `{ versionId, b, artifactId, projectId }`.
- Compare screen: renders both versions' sections from mocked `getVersion`; a section differing
  between A and B is marked changed (assert the "changed" testID/label); an A-only section marks
  removed + a placeholder on B.
- Responsive: at width ≥700 both panes render in the row container; narrow → stacked (assert via a
  layout testID or the container style, however the existing suite checks layout).

## Files

**Mobile**
- `app/trust/[projectId].tsx` — View affordance + timestamp on version rows (both panels); Compare
  mode (select-2) + `onCompare` handler; new state.
- `app/trust/compare/[versionId].tsx` (new) — the compare screen.
- `src/lib/versionTimestamp.ts` (new) — date+time formatter (or extend an existing date util).
- Tests: `mobile/__tests__/screens/TrustProjectDetail.*` (rows + compare-select) and
  `mobile/__tests__/screens/TrustCompare.*` (new).

**Backend:** none.

## Rollout

Mobile/web only — **no backend change, no migration**. Ship = web redeploy (+ APK if native wanted).
