# Studio P2 — App chrome + content sweep — Design

**Status:** Approved (brainstorming, 2026-08-09). Third slice of the Studio re-skin
([[project_studio_reskin]]); P0 foundations + P1 primitives/SME surfaces already shipped
(PR #386, main `8916857`). Companion: `docs/superpowers/specs/2026-08-08-studio-reskin-design.md`.

## Problem

The Studio identity (navy `#0A0E1A` ground, gold `#F0DCAC` accent, Playfair Display headings +
Inter body at 400/500, ghost/hairline controls, tracked uppercase micro-labels) landed on the
SME/Projects surfaces in P1 but stops at the app shell. Two visible gaps remain:

1. **The per-screen header is off-identity.** `mobile/app/_layout.tsx` sets a native
   React-Navigation Stack header with **hardcoded** `#0f172a` background, `#f1f5f9` tint, and a
   `fontWeight: "700"` title (e.g. `‹ Project`). No Playfair, no branding — the most visible
   unfinished strip on every stack screen.
2. **The content screens never adopted the P1 primitives.** `library`, `books`, `settings`,
   `help`, `about` already use `useThemedStyles` (so they render studio-dark colors from P0), but
   none import `@/components/ui/*` and each still carries raw `fontWeight: 600/700` headings and
   ad-hoc filled controls — the "too thick / clunky" complaint that started the re-skin.

## Goal

Finish the Studio shell: a **branded wordmark header** on stack screens, the remaining **content
screens migrated to P1 primitives**, and the last P1 carryover (Add-source ghost) cleaned up. No
new concepts — this applies the P0 tokens + P1 primitives already on `main`.

## Locked decisions (brainstorming 2026-08-09)

1. **Full P2 in one branch** — chrome (header) + content sweep together.
2. **Keep the beveled nav tiles** (`TopNavBar` / `SideNav`). They are already fully token-driven
   (`c.tileOffFace`/`c.tileOnFace`/…) so they render studio-dark for free; do **not** convert them
   to flat underline tabs. The only change: tile label weight `600 → 500` (Inter-500 body rule).
3. **Branded wordmark header** (custom component), not a token-swap of the native bar.
4. **Curated per-screen kickers** — a `routeName → kicker` map, not the raw title. Unmapped screens
   fall back to the uppercased `title`.
5. **Mobile-only** — no backend refresh; web redeploy + APK later.

## Architecture

### A. Chrome — `StudioHeader` (new)

**`mobile/src/components/StudioHeader.tsx`** — a custom React-Navigation header
(`NativeStackHeaderProps`): a hairline back chevron (shown when `back` is present →
`navigation.goBack()`), the Playfair `MENTIBLE` wordmark, and a tracked-uppercase kicker beneath
it, all on studio-dark tokens with a hairline bottom border. Uses `useThemedStyles` +
`useSafeAreaInsets` (top inset). The wordmark uses the Playfair heading family (≥16px floor —
[[project_studio_reskin]]); the kicker is a small tracked `c.textMuted` label.

**Kicker source** — a `SECTION_KICKERS: Record<string, string>` map (in `StudioHeader.tsx` or
`components/navItems.ts`) keyed by `route.name`, e.g.:

| route.name | kicker |
|---|---|
| `trust/[projectId]` | `PROJECT` |
| `trust/new` | `NEW PROJECT` |
| `trust/version/[versionId]` | `DRAFT` |
| `trust/topic-version/[id]` | `DRAFT` |
| `book/new` | `NEW BOOK` |
| `book/saved/[id]` | `EDIT BOOK` |
| `book/generate/[id]` | `WRITE TOPICS` |
| `book/topic/[bookId]/[topicId]` | `TOPIC` |
| `book/read/[id]` | `READ` |
| `book/reviews/[id]` | `REVIEWS` |
| `account` · `usage` · `paywall` · `admin` · `admin/[sub]` · `sign-in` | `ACCOUNT` · `USAGE` · `PLANS` · `ADMIN` · `USER` · `SIGN IN` |
| `concepts` · `diagram-types` | `PROTOTYPE` · `DIAGRAM TYPES` |

Fallback for any route not in the map: `options.title` uppercased (so nothing renders blank).

**Wiring** — in `mobile/app/_layout.tsx`, replace the hardcoded `headerStyle`/`headerTintColor`/
`headerTitleStyle` in `screenOptions` with `header: (props) => <StudioHeader {...props} />` (and
keep `contentStyle.backgroundColor` moved to a token). Tab screens keep `headerShown: false` and
their (kept) TopNavBar. Per-screen `Stack.Screen` `title`/`headerBackTitle` options stay as-is
(title still feeds the fallback + accessibility); no per-screen edits required.

### B. Sweep — 5 content screens adopt P1 primitives

`library.tsx`, `books.tsx`, `settings.tsx`, `help.tsx`, `about.tsx`: replace raw
`<Text style={{fontWeight:600/700}}>` headings with Playfair heading styles / `<Label>`; ad-hoc
filled controls with `<Button>` (ghost default; **one** gold `variant="primary"` pill per view max);
ad-hoc card containers with `<Card>`; section eyebrows with the tracked-uppercase `<Label>`. Colors
are already tokenized — this is **typography + control-style**, not a palette change. Follow the
exact patterns P1 established on `projects.tsx`/`[projectId].tsx` (read them as the reference).
`index.tsx` is a 7-line redirect — skip.

### C. P1 carryover

`trust/[projectId].tsx`: flip the "Add source" `Button variant="primary"` (filled full-width gold)
→ `variant="ghost"` (gold reserved for one pill per view); tighten card border brightness / vertical
air toward the mockup where it visibly lags.

## Reuse map

- `@/components/ui/{Label,Button,Card,Chip}` (P1) → the 5 content screens + StudioHeader labels.
- `projects.tsx` / `trust/[projectId].tsx` (P1-migrated) → the reference pattern for the sweep.
- `themes["studio-dark"]` palette tokens (P0) → StudioHeader colors + all sweep typography.
- The Playfair heading family via the `applyGlobalFont`/`fonts.ts` resolver (P0) → wordmark + headings.

## Testing

- **StudioHeader:** renders the wordmark + the curated kicker for a given `route.name` (assert the
  mapped string for `trust/[projectId]` → `PROJECT`; assert fallback uppercases an unmapped title);
  the back chevron shows only when `back` is present and calls `navigation.goBack()`. Assert the
  Playfair family + weight are pulled from `themes["studio-dark"]`/the resolver — **no color-literal
  asserts** ([[project_studio_reskin]]).
- **Sweep screens:** assert the primitives are used (e.g. `getByRole`/testID from `Button`/`Card`,
  no residual `fontWeight: "700"` in the rendered heading styles) and the screen still renders its
  key content. Keep existing screen tests green; update any that asserted a raw `<Text>` now inside
  a primitive.
- **Flexbox/Playfair traps are jsdom-blind** (no Yoga) — the plan's final step is a **device/web
  screenshot verify** of the header + each swept screen (tile stretch, Playfair not collapsing to
  Regular in dyslexic mode, no text-collapse). Mirror the P1 verification.
- **Help coverage gate** (`mobile/__tests__/help/coverage.test.ts`) — unaffected; P2 ships **no new
  feature keys** (pure re-skin), so no new Help topics are owed.

## Files

- Create: `mobile/src/components/StudioHeader.tsx` (+ `SECTION_KICKERS`); test
  `mobile/__tests__/components/StudioHeader.test.tsx`.
- Modify: `mobile/app/_layout.tsx` (wire `header`, drop hardcoded colors).
- Modify: `mobile/app/(tabs)/{library,books,settings,help,about}.tsx` (primitive adoption) + their
  existing tests.
- Modify: `mobile/app/(tabs)/... TopNavBar`/`SideNav` label weight `600→500` (one token each).
- Modify: `mobile/app/trust/[projectId].tsx` (Add-source ghost + card/air tighten).

## Decomposition (6 SDD tasks)

- **T1 — StudioHeader** + kicker map + wire into `_layout.tsx` (drop hardcoded header colors).
- **T2 — P1 carryover:** Add-source ghost flip + `[projectId]` card/air tighten; **and** the nav
  label weight `600→500` (TopNavBar + SideNav) — small, chrome-adjacent.
- **T3 — Library** sweep.
- **T4 — Books** sweep.
- **T5 — Settings** sweep.
- **T6 — Help + About** sweep.

## Rollout

Mobile-only → **web redeploy** (`scripts/deploy/web-deploy.sh app`) + APK later. **No backend
refresh.** Existing users already default to studio-dark (P0); this is pure shell polish — no data
or behavior change.

## Out of scope

- `posts.tsx` / `shelves.tsx` (not in the P2 list — a later sweep).
- P3 reader (chrome + navy reading surface) and P4 compiler EPUB3/PDF export typography — their own
  specs.
- Converting the nav tiles to flat underline tabs (explicitly rejected — tiles kept).

## Global constraints

Playfair headings ≥16px, never on small UI text; retire 600/700 (nav tiles → 500); ghost controls,
one gold pill per view; tracked uppercase micro-labels; `useThemedStyles`, assert role/family off
`themes["studio-dark"]`, **no color-literal test asserts**; `Button onPress:()=>void` can't carry an
event (a control nested in a Pressable needing `stopPropagation` stays raw). Reuse the P1 primitives
— do NOT fork a second Button/Card. `npx tsc --noEmit` clean + full `npx jest` green.
