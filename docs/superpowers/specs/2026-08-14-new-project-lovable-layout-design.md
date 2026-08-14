# New-project screen — Lovable layout — Design

**Status:** Approved (brainstorming, 2026-08-14). UI restyle of `mobile/app/trust/new.tsx` to match the
Lovable prototype's new-project screen (`mentible_loverable_ux/src/routes/_authenticated/app/new.tsx`).
Layout only — same fields (Title · Topic · Audience · Goal), same `create()` call, same RequireSignIn +
Free/Pro cap wall. Our tokens already match Lovable (Fraunces + gold + navy, Studio re-skin).

## Element-by-element (Lovable → ours)

1. **Back link** — a "← Back to projects" affordance at the top (arrow glyph + text, `textMuted`,
   accessibilityRole button) → `router.back()` (fallback `router.replace("/projects")`).
2. **Display heading** — keep the Fraunces "New project" heading (bump toward the prototype's 3xl/4xl:
   `typography.sizeXxl`/`sizeXxxl` if present, else the current XXL) + the existing subhead.
3. **Topic = multi-line** — the Topic `TextInput` becomes `multiline` (≈3 rows: `minHeight` ~ 3×line,
   `textAlignVertical: "top"`), `maxLength={500}`.
4. **Audience + Goal side-by-side** — on `isTablet` render Audience + Goal in a **2-column row**
   (`flexDirection:"row"`, `gap`, each `flex:1`); on phone they **stack** (column). Title + Topic stay
   full-width single-column.
5. **Kicker labels + required marker** — field labels become uppercase, letter-spaced, `textMuted`
   (kicker style). Title shows a required `*` (in `c.error`/destructive tone). Keep `accessibilityLabel`
   = the plain label.
6. **Pill Create button** — the primary `Button` gets a **pill** radius (`radius.full`),
   `alignSelf:"flex-start"` (not full-width), generous horizontal padding; busy label "Creating…" (pass
   the Button's busy prop; if it shows text, "Creating…"). Keep `disabled={atProjectCap}` + the cap hint.
7. **maxLength** — Title `maxLength={120}`, Topic `maxLength={500}`.
8. **Centered column** — wrap the form in a centered container with a `maxWidth` (~640) that
   `alignSelf:"center"` on wide screens (via `useResponsive`), so it doesn't stretch full-width on
   tablet/desktop-web. On phone it's just full-width with padding.

## What does NOT change

- Fields, state, `submit()`/`create()` payload, the 402→upgrade handling, `atProjectCap` UX wall +
  server-authoritative 402, `RequireSignIn action="start a project"`, the title-required guard.

## Architecture

Rewrite `NewProjectInner`'s render + `makeStyles` in `mobile/app/trust/new.tsx`. Enhance the `field`
helper to accept `{ multiline?, required?, maxLength?, keyboardType? }` and render the kicker label + `*`.
Add `useResponsive` for the 2-col Audience/Goal + the centered max-width. Reuse `FRAUNCES`, `radius.full`,
theme tokens, `Button` (`style` override for the pill). No new deps.

## Testing

RNTL screen test (extend/replace the existing new-project test if any): the Title/Topic/Audience/Goal
inputs render + accept text; Topic is multiline (`props.multiline === true`); the back link navigates
(`router.back` mocked); "Create project" calls `create` with the trimmed payload; the title-required guard
still fires on empty; `atProjectCap` disables Create + shows the hint (fail-open on `plan == null`); a 402
→ the upgrade alert. No color-literal asserts.

## Rollout

Web deploy + APK. Mobile-only; no backend, no migration.

## Global constraints

- No color-literal asserts; theme via `useThemedStyles`/tokens; `Alert` from `@/lib/alert`; Fraunces from
  `@/constants/fonts`. Preserve the cap wall + RequireSignIn. Mobile `npx tsc --noEmit` + full `npx jest`
  + `npx eslint .`. Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
