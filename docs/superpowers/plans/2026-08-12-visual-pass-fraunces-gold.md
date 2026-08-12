# Visual pass — Fraunces + warmer gold + rounder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the app-screen visual identity closer to the Lovable sample — Fraunces headings, a
warmer dark gold, moderately rounder cards — keeping our flat hairline cards. Mobile-only, no backend.

**Architecture:** Font swap via the shared resolver + a chrome-only PLAYFAIR→FRAUNCES codemod; a
studio-dark gold + radius token retune; a two-pill hierarchy fix on the version panel.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-visual-pass-fraunces-gold-design.md`.
- **Mobile-only, no backend/behavior change.** Keep flat cards (no shadows).
- **Font swap is CHROME-ONLY.** Do NOT touch the reader/book-content path: `app/book/read/[id].tsx`,
  `src/reader/playfairFont.ts`, `src/components/contentHtml.ts` stay on Playfair. Leave the `PLAYFAIR`
  constant defined.
- **Retune studio-DARK only** (`studioDarkColors`). Do NOT touch `studioLightColors` or any other
  palette. Preserve `primaryText` (`#0A0E1A`) AA contrast on the new gold.
- No color-literal asserts in COMPONENT tests; the palette's own unit test MAY assert token values.
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

Tasks are largely file-disjoint but run **sequentially** (never two implementers at once; a task
reviewer may overlap the next implementer).

---

### Task 1: Headings → Fraunces (chrome)

**Files:**
- Modify: `mobile/src/constants/fonts.ts` (resolver), the chrome screens below, and
  `mobile/__tests__/lib/applyGlobalFont.test.ts`.
- Chrome screens to codemod `PLAYFAIR.*` → `FRAUNCES.*`: `mobile/app/(tabs)/books.tsx`,
  `library.tsx`, `posts.tsx`, `projects.tsx`, `reviews.tsx`, `settings.tsx`, `shelves.tsx`,
  `help.tsx`; `mobile/app/trust/[projectId].tsx`, `mobile/app/trust/topic-version/[id].tsx`,
  `mobile/app/trust/new.tsx`; `mobile/src/components/StudioHeader.tsx`,
  `mobile/src/components/SideNav.tsx`.
- **Do NOT touch:** `app/book/read/[id].tsx`, `src/reader/playfairFont.ts`,
  `src/components/contentHtml.ts`, `src/lib/applyGlobalFont.ts` (no edit needed), and the `PLAYFAIR`
  definition in `fonts.ts`.

- [ ] **Step 1: Write/adjust the failing test.** In `applyGlobalFont.test.ts`, change the heading-role
  expectation to a `Fraunces_*` family (find the assertion that currently expects
  `PlayfairDisplay_*` for a heading-intent style; assert `Fraunces_600SemiBold` / the resolver's
  heading output). Run — verify it fails against current code.

- [ ] **Step 2: Flip the resolver.** In `mobile/src/constants/fonts.ts`, the heading branch
  `if (role === "heading") return PLAYFAIR[b];` → `return FRAUNCES[b];`. Confirm `FRAUNCES` is in the
  loaded font map so web + native have the faces (it's imported; verify it's included in
  `FONT_ASSETS`/the `useFonts` set — add it there if missing). Optionally point the web "serif"
  fallback stack (in `typography`) at Fraunces for literal-`serif` sites.

- [ ] **Step 3: Codemod the chrome screens.** In EACH chrome file above, replace `PLAYFAIR.semibold`
  → `FRAUNCES.semibold`, `PLAYFAIR.bold` → `FRAUNCES.bold`, `PLAYFAIR.medium` → `FRAUNCES.medium`, and
  the import `PLAYFAIR` → `FRAUNCES` from `@/constants/fonts` (add `FRAUNCES` import, drop `PLAYFAIR`
  if now unused in that file). Do not change any other styling.

- [ ] **Step 4: Verify.** `cd mobile && npx jest __tests__/lib/applyGlobalFont.test.ts && npx tsc
  --noEmit`. Then grep to confirm no chrome file still imports/uses `PLAYFAIR`
  (`grep -rn "PLAYFAIR" mobile/app/(tabs) mobile/app/trust mobile/src/components` → only expected
  none), while the reader files still do.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/constants/fonts.ts "mobile/app/(tabs)" mobile/app/trust mobile/src/components mobile/__tests__/lib/applyGlobalFont.test.ts
git commit -m "feat(ui): app-chrome headings → Fraunces (reader/book stays Playfair)"
```

---

### Task 2: Warmer dark gold + rounder radii

**Files:** Modify `mobile/src/constants/theme.ts`; add/extend a palette unit test.

- [ ] **Step 1: Write the failing test** (a small `theme` token test — new file or extend an existing
  constants test): assert `studioDarkColors.primary === "#D6A94B"`, `studioLightColors.primary ===
  "#8A6A22"` (unchanged), `radius.md === 14`, `radius.lg === 22`. (These value assertions are the
  deliverable — allowed on the palette's own unit test.) Run — verify fail.

- [ ] **Step 2: Implement.** In `studioDarkColors` ONLY, replace every `#F0DCAC` with `#D6A94B`
  (`primary`, `brand`, `growth`, `tileOffGlyph`, `tileOnFace`); set `tileOnHi` → `#E6C87E`, `tileOnLo`
  → `#A9853C`. In `radius`, `md: 10` → `14`, `lg: 16` → `22`. Do NOT touch `studioLightColors`, other
  palettes, `sm`, or `full`. Leave `primaryText`/glyph `#0A0E1A`.

- [ ] **Step 3: Verify** — `cd mobile && npx jest <theme test> && npx tsc --noEmit`. If any existing
  test pinned the old `#F0DCAC` or the old radii, update it intentionally (note which).

- [ ] **Step 4: Commit.**
```bash
git add mobile/src/constants/theme.ts mobile/__tests__
git commit -m "feat(ui): warmer studio-dark gold (#D6A94B) + rounder radii (md14/lg22)"
```

---

### Task 3: Two-pill fix on the version panel

**Files:** Modify `mobile/app/trust/version/[versionId].tsx`; extend its test.

- [ ] **Step 1: Write the failing test** (or extend the revise-role test): with an owner + unapproved
  version, both "Revise" and "Approve" render; assert "Revise" now uses the SAME style bucket as the
  secondary "Edit text" control and NOT the filled approve style. Prefer asserting via a testable
  signal that doesn't hard-code colors — e.g. that the Revise Pressable's `style` equals the Edit
  control's style object (`styles.editBtn`) rather than `styles.approveBtn`. If style-object identity
  isn't easily assertable in the existing seam, assert the (unchanged) labels both render and rely on
  the reviewer to confirm the style swap. No color-literal asserts.

- [ ] **Step 2: Implement.** Change the owner "Revise" `Pressable` (currently `style={styles.approveBtn}`
  with `styles.approveText`) → `style={styles.editBtn}` / `styles.editBtnText` (the secondary style
  used by "Edit text"/"Copy"). Leave `openRegen` and everything else unchanged. "Approve" stays
  `styles.approveBtn` (the single filled primary).

- [ ] **Step 3: Verify** — `cd mobile && npx jest __tests__/screens/TrustVersion && npx tsc --noEmit`.

- [ ] **Step 4: Commit.**
```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__
git commit -m "fix(ui): Revise as secondary so Approve is the single filled-primary (two-pill fix)"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] Grep confirms chrome screens use `FRAUNCES` (not `PLAYFAIR`); reader/book files unchanged
  (still `PLAYFAIR`); only `studioDarkColors`/`radius` changed in theme.ts; version panel Revise is
  secondary.
- [ ] **Web screenshot verify** (local expo web, dev-token + stub per the 08-11 pin): a trust screen
  header renders in **Fraunces** (soft serif, not Playfair); the gold accent reads warmer; cards are
  rounder; the version panel shows a single filled "Approve" with "Revise" secondary. A reader/book
  view still shows Playfair (unchanged).
- [ ] PR body: visual pass (Fraunces chrome headings + warmer dark gold + rounder radii + two-pill
  fix); flat cards kept; compiler exports + reader font deferred; mobile-only → web redeploy.

## Self-Review

- **Spec coverage:** Fraunces chrome (T1) · dark gold + radii (T2) · two-pill (T3). Reader/light-palette/
  exports/shadows correctly out of scope.
- **Type consistency:** `FRAUNCES` has the same keys as `PLAYFAIR` (`regular/medium/semibold/bold`), so
  the codemod is type-safe; `radius`/palette are plain literals.
- **Constraints:** chrome-only font; studio-dark-only gold; flat cards; AA preserved; component tests
  color-literal-free.
