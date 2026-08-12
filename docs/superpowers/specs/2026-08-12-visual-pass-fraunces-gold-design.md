# Visual pass — Fraunces headings + warmer gold + rounder — Design

**Status:** Approved (brainstorming, 2026-08-12). Brings the app's visual identity closer to Sridhar's
Lovable prototype ([[project_lovable_ux_teardown]]) — the user noted our fonts/accents don't match the
sample. Third slice of the Lovable adaptation (after the guided banner #411 and the unified panel
#412). App screens only; **compiler EPUB/PDF exports deferred**.

## Problem

Lovable's sample uses **Fraunces** (soft serif) headings + a **warm mid-gold** accent
(`oklch(0.75 0.13 80)`) with rounded cards. Ours (Studio re-skin) uses **Playfair Display** headings, a
**pale** gold `#F0DCAC` on the default dark theme, and small radii. Same family, but the serif, the
gold, and the roundness read differently.

## Goal

Match Lovable's feel on the app screens: swap headings to Fraunces, warm the dark gold, and round the
cards moderately — **keeping our flat hairline-card identity** (no soft shadows). Mobile-only, no
backend.

## Locked decisions (brainstorming 2026-08-12)

1. **Headings → Fraunces** (already bundled). Body stays Inter.
2. **Accent → warmer gold, DARK theme only.** Studio-dark's `#F0DCAC` → a warm mid-gold; studio-light's
   gold `#8A6A22` is already a proper AA-safe warm gold — **left unchanged** (avoids a11y risk on white).
3. **Radii → moderately rounder** (not `rounded-3xl`).
4. **Keep flat cards — NO shadows** (deliberate deviation from Lovable; our `Card` reads by its 1px
   border, a Studio identity decision).
5. **Two-pill fix:** on the version panel, **Approve stays the single filled-primary**; **Revise
   becomes secondary** (like Edit) — removing the two-competing-pills nit from #412.
6. **Scope = app screens only.** Compiler exports deferred; no backend.

## Architecture

### A. Headings → Fraunces (`mobile/src/constants/fonts.ts` + ~21 screens + `applyGlobalFont`)
- `FRAUNCES` is already exported (`Fraunces_400/600/700`). Change the interceptor's heading role
  (`fonts.ts` ~line 159: `if (role === "heading") return PLAYFAIR[b];` → `FRAUNCES[b]`).
- Point the web serif heading stack (in `typography`) at Fraunces.
- Migrate the explicit `PLAYFAIR.*` usages in **app-CHROME screens** → `FRAUNCES.*` (mechanical;
  `FRAUNCES.medium` exists, rounds to Fraunces_400Regular). Chrome files: `app/(tabs)/*`
  (books, library, posts, projects, reviews, settings, shelves, help), `app/trust/[projectId].tsx`,
  `app/trust/topic-version/[id].tsx`, `app/trust/new.tsx`, `src/components/StudioHeader.tsx`,
  `src/components/SideNav.tsx`.
- **EXCLUDE the reader / book-content render path — leave it on Playfair:**
  `app/book/read/[id].tsx`, `src/reader/playfairFont.ts`, `src/components/contentHtml.ts`. That is
  *book content* typography, which travels with the deferred compiler/book identity, not app chrome.
  `src/lib/applyGlobalFont.ts` needs no edit (it already recognizes both faces as heading-intent);
  the single resolver flip is in `fonts.ts`. Leave the `PLAYFAIR` constant defined (reader + compiler
  + stragglers still use it).
- Update `mobile/__tests__/lib/applyGlobalFont.test.ts` so the heading-role expectation is Fraunces.

### B. Warmer dark gold (`mobile/src/constants/theme.ts` → `studioDarkColors` only)
- Replace the pale gold `#F0DCAC` with a warm mid-gold **`#D6A94B`** everywhere it appears in
  `studioDarkColors`: `primary`, `brand`, `growth`, `tileOffGlyph`, `tileOnFace`. `primaryText`/glyphs
  stay `#0A0E1A` (near-black on gold = strong AA).
- Adjust the gold tile bevel tints to the new gold: `tileOnHi` `#F7E9C6`→**`#E6C87E`**, `tileOnLo`
  `#B79A5E`→**`#A9853C`**.
- `warning` `#E7C98A` may stay (semantic, not the accent). **Do NOT touch `studioLightColors`** or any
  other palette.

### C. Rounder radii (`mobile/src/constants/theme.ts` → `radius`)
- `md` 10 → **14**, `lg` 16 → **22**. `sm` (6) and `full` unchanged. App-wide (all Card/Button).

### D. Two-pill fix (`mobile/app/trust/version/[versionId].tsx`)
- The owner "Revise" button (currently `styles.approveBtn`/`approveText`, filled) → switch to the
  **secondary** style used by Edit (`styles.editBtn`/`editBtnText`), so only "Approve" renders
  filled-primary. Behavior (`openRegen`) unchanged. Rationale: approval/validation is the panel's
  decisive action and reviewers (who can't Revise) get a clear single primary.

## Testing

- **`applyGlobalFont`**: the heading role resolves to a `Fraunces_*` family (update existing test).
- **A spot check** on a screen that used `PLAYFAIR.*`: its heading style now references a Fraunces
  family (or the interceptor yields Fraunces). No `PLAYFAIR_*` family remains referenced in app
  screens (grep-style assertion or a targeted test).
- **Theme tokens**: `studioDarkColors.primary === "#D6A94B"` and `studioLightColors` unchanged; `radius.md === 14`, `radius.lg === 22`. (Value assertions are fine here — these ARE the deliverable; the "no color-literal asserts" rule is about not hard-coding palette hexes in *component* tests, not the palette's own unit test.)
- **Version panel**: "Revise" no longer uses the filled approve style; "Approve" remains filled. Assert
  by the (unchanged) accessibility labels + that both render; no color-literal asserts on the screen test.
- Full `npx jest` green (watch for snapshot/contrast tests that pinned the old gold/Playfair — update
  intentionally), `npx tsc --noEmit` clean.

## Files

- Modify: `mobile/src/constants/fonts.ts`, ~21 screens under `mobile/app` + `mobile/src` (PLAYFAIR→FRAUNCES),
  `mobile/__tests__/lib/applyGlobalFont.test.ts`
- Modify: `mobile/src/constants/theme.ts` (studioDark gold + radius)
- Modify: `mobile/app/trust/version/[versionId].tsx` (Revise → secondary)

## Decomposition (SDD) — sequential (some files overlap)

- **T1 — Headings → Fraunces** (fonts.ts interceptor + web stack + PLAYFAIR→FRAUNCES codemod + test).
- **T2 — Warmer dark gold + rounder radii** (theme.ts only). After T1.
- **T3 — Two-pill fix** (version panel). After T1 (T1's codemod may touch that file's headings).

## Rollout

Mobile-only → **web redeploy**, no backend, no migration. Real-device/web eyeball recommended (font +
gold are visual).

## Out of scope

- Compiler EPUB/PDF exports (Playfair + export gold stay this pass).
- Soft-shadow / elevated cards (keep flat hairline).
- studio-light and all non-Studio palettes' accent; the `PLAYFAIR` constant's definition (kept).
- Full `rounded-3xl`; per-topic panel; any behavior/backend change.

## Global constraints

Mobile-only, no backend/behavior change. Keep flat cards. Retune **studio-dark only** (light + other
palettes untouched). Preserve `primaryText` AA contrast on the new gold. `useThemedStyles`; **no
color-literal asserts in component tests** (palette unit tests may assert token values). `npx tsc
--noEmit` clean + full `npx jest` green. Commit messages end with `Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>`.
