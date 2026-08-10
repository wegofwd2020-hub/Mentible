# Studio straggler sweep — Design

**Status:** Approved (brainstorming, 2026-08-10). Cleanup after the Studio re-skin arc
([[project_studio_reskin]], P0→P4 shipped). Applies the **P2 content-sweep pattern** to the last three
surfaces P2 didn't cover.

## Problem

The Studio re-skin's P2 slice migrated Library/Books/Settings/Help/About to the P1 primitives, but three
surfaces were out of P2's scope and still carry pre-Studio styling: `mobile/app/(tabs)/posts.tsx`,
`mobile/app/(tabs)/shelves.tsx` (Open Shelves catalog), and `mobile/src/components/CheckoutButton.tsx`
(the shared EPUB/PDF checkout control — the P3 T4 review explicitly flagged it as left raw). Each already
uses `useThemedStyles` (so it renders studio-dark colors), but none imports the P1 primitives and each
still has raw `fontWeight: 600/700` (posts 8, shelves 5, Checkout 2).

## Goal

The three stragglers adopt the P1 primitives + Playfair headings, matching the P2 screens — closing the
last visual inconsistencies of the re-skin. Typography + control-style only; no behavior change.

## Locked decision

Apply the **exact P2 pattern** (reference `mobile/app/(tabs)/projects.tsx`) — no new design, no new
primitive.

## Architecture (the sweep pattern)

Per file: replace raw `<Text style={{fontWeight:600/700}}>` headings with Playfair
(`fontFamily: PLAYFAIR.semibold`, `letterSpacing: -0.36`, ≥16px; drop the weight); ad-hoc filled
controls → `<Button variant="ghost">` (ghost default; **one** gold `variant="primary"` pill per view
max); ad-hoc bordered `View`s (own `borderWidth`/`borderColor` + padding) → `<Card>`; section
eyebrows/metadata → `<Label tone="muted"|"secondary">`. Import only the primitives actually used (no
unused imports).

**Keep raw** (do NOT convert to `<Button>`): any Pressable that is a **nav-target row** or that nests an
action needing `e.stopPropagation()` (event-bubbling — `Button onPress:()=>void` can't carry an event);
any icon+text control whose glyph is essential (`Button` has no icon slot). Small (≤14px) labels stay
Inter, never Playfair.

**Per-file notes:**
- `shelves.tsx` — the Open Shelves catalog list rows are navigation targets → stay raw Pressable; only
  headings/eyebrows/standalone action buttons get the treatment.
- `posts.tsx` — the social Posts surface; same rubric.
- `CheckoutButton.tsx` — the labeled EPUB/PDF checkout action → `<Button>` (variant per its role on the
  read screen; if the read screen already has a gold primary, this becomes ghost). Preserve its
  onPress/checkout behavior exactly.

## Testing

Per file: the primitives are used (content still found via `getByText`/role after wrapping in
`<Card>`/`<Button>`); no rendered heading style carries `fontWeight:"700"` (or the title uses
`PLAYFAIR.semibold`); existing behavior assertions stay green and unchanged. **No color-literal test
asserts.** The flexbox/Playfair traps are jsdom-blind → note a device/web screenshot pass in the report.

## Files

- Modify: `mobile/app/(tabs)/posts.tsx`, `mobile/app/(tabs)/shelves.tsx`,
  `mobile/src/components/CheckoutButton.tsx` + their existing tests under `mobile/__tests__/`.

## Decomposition (3 SDD tasks)

- **T1 — posts.tsx** sweep.
- **T2 — shelves.tsx** sweep (keep catalog nav rows raw).
- **T3 — CheckoutButton.tsx** sweep (labeled action → `<Button>`, behavior preserved).

## Rollout

Mobile-only → **web redeploy** (`scripts/deploy/web-deploy.sh app`), no backend, no migration.

## Out of scope

New behavior; the reader/compiler (P3/P4, shipped); the manual device verifies still owed on P3/P4.

## Global constraints

Playfair headings ≥16px, retire 600/700; ghost-default + one gold pill per view; tracked-uppercase
micro-labels via `<Label>`; keep nav-target/stopPropagation Pressables raw; reuse the P1 primitives (no
fork); `useThemedStyles`; **no color-literal test asserts**; behavior identical. `npx tsc --noEmit` clean
+ full `npx jest` green.
