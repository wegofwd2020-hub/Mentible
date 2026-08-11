# Trust Input — per-kind source fields — Design

**Status:** Approved (brainstorming, 2026-08-11). Addresses Sridhar's live-test report: the Input
phase's three source kinds (Transcript / Note / Link) present an **identical** single content box,
so the kind picker earns nothing, a **Link** has no field for its URL, and the "Add source" button
sits **greyed out** because the required field for the chosen kind isn't obvious (a user who fills
only the optional Title, or pastes a URL nowhere useful, never enables it). Related:
[[feedback_sridhar_addsource_2026-08-11]], [[feedback_sridhar_testrun_2026-08-07]],
[[feedback_real_gap_is_wayfinding]].

## Problem

In `mobile/app/trust/[projectId].tsx` (`SourcesPhase`, owner-only add form):
- The kind picker sets `sourceKind` but the input below is one `content` `TextInput` for all three
  kinds (same placeholder "Paste a transcript, note, or link…").
- `onAddSource` sends only `{kind, title, content}` — a Link's URL (`source_ref`) is never captured
  on the add form (it's only editable *after* creation, in edit mode).
- The Add button is `disabled={!sourceContent.trim()}`. Nothing on the form signals that the big box
  is the required field, so the button reads as "broken / greyed out."

Backend already accepts `source_ref` (schema `ProjectInputIn`: `kind ∈ {transcript,note,link}`,
`content` required 1–200 000, `source_ref` optional ≤500). **No backend change needed.**

## Goal

Make each kind capture the field it promises, and make the required field obvious — fixing both the
"all the same" complaint and the greyed-button trap, with a mobile-only change.

## Locked decisions (brainstorming 2026-08-11)

1. **Per-kind fields** (keep the picker):
   - **Link** → a single-line **URL** field + optional **Label**. No paste box.
   - **Transcript / Note** → the existing big **paste box** + optional **Title** (unchanged).
2. **Link mapping on add:** `{kind:"link", title: label.trim()||undefined, content: url.trim(),
   source_ref: url.trim()}`. `content = url` satisfies the backend's `content min_length=1` and gives
   the source-list row a meaningful preview; the URL's real home is `source_ref`.
3. **Enable logic:** `canAdd = kind === "link" ? sourceUrl.trim() : sourceContent.trim()` drives the
   button's `disabled`. The visible required field for the chosen kind is the one that enables Add.
4. **Scope:** ADD form only. Edit mode already exposes `content` + `source_ref`; leave it. No URL
   scheme validation beyond non-empty (don't reject valid-but-odd inputs); backend caps `source_ref`
   at 500 chars, so a very long URL still errors cleanly via the existing Alert.

## Architecture

`SourcesPhase` in `mobile/app/trust/[projectId].tsx`:
- Add state `sourceUrl` (string) alongside `sourceKind` / `sourceTitle` / `sourceContent`.
- Render, when `sourceKind === "link"`:
  - Label field (`sourceTitle`, placeholder "Label (optional)") — reuse the existing title input.
  - URL field (`sourceUrl`, placeholder "https://…", `autoCapitalize="none"`,
    `keyboardType="url"`, single-line).
  Else (transcript/note): the current Title input + the multiline paste box (`sourceContent`).
- Button `disabled={!canAdd}` where `canAdd` per decision 3.
- `onAddSource`: branch on kind —
  - link → `addInput({ kind:"link", title: sourceTitle.trim()||undefined, content: url, source_ref: url })`
  - else → `addInput({ kind, title: sourceTitle.trim()||undefined, content })` (as today).
  On success clear title, content, **url**, reset kind to `"note"`.
- The empty-state helper text stays; optionally note "For a link, paste the URL."

Props: `SourcesPhase` gains `sourceUrl` / `setSourceUrl` (mirroring `sourceContent` /
`setSourceContent`) OR the URL state stays inside the phase component if it already owns the other
source state. Match the existing ownership (the other `source*` state lives in the parent screen and
is threaded down as props — thread `sourceUrl` the same way for consistency and testability).

`addInput` (hook) already accepts `source_ref` — no change.

## Testing

- **Link kind renders the URL field, not the paste box:** select Link → a field with placeholder
  "https://…" is present; the multiline "Paste a transcript…" box is not.
- **Add a link sends source_ref + content=url:** with kind=link and URL set, tapping Add calls
  `addInput` with `{kind:"link", source_ref:<url>, content:<url>}`; title omitted when blank.
- **Button gating per kind:** kind=link + empty URL → Add disabled; fill URL → enabled. kind=note +
  empty box → disabled; fill box → enabled.
- **Note/transcript unchanged:** kind=note with content still sends `{kind:"note", content}` and no
  `source_ref`.
- No color-literal asserts; `useThemedStyles`/existing styles.

## Files

- Modify: `mobile/app/trust/[projectId].tsx` (`SourcesPhase` render + `onAddSource` + `sourceUrl`
  state).
- Test: the existing `[projectId]` / SourcesPhase test (extend).

## Decomposition (SDD)

- **T1 — per-kind fields:** `sourceUrl` state; conditional URL-vs-paste rendering; `canAdd` gating;
  `onAddSource` link branch; clear-on-success. Tests. (Single cohesive task — one file.)

## Rollout

Mobile-only → **web redeploy**, no backend, no migration.

## Out of scope

- Backend schema changes (none needed).
- Edit-mode reshaping (already exposes content + source_ref).
- URL validation / normalization, link title auto-fetch, dropping or merging kinds (Transcript vs
  Note kept as distinct metadata per the chosen approach).
- Item unrelated to add: any deeper Input-source versioning/staleness model (separate, parked).

## Global constraints

Mobile-only, no generation-behavior change. `useThemedStyles` / reuse existing input styles; NO
color-literal test asserts. `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end
with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
