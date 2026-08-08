# Studio Re-skin — theme-wide visual refinement — Design

**Status:** Approved (brainstorming, 2026-08-08). Mockup locked (Input screen, navy + light):
Artifact `419338c8-25a9-4552-998d-735d32b33384` (v2, contrast-lifted).

## Problem

Local testing (user + Sridhar) found the Projects/SME surfaces read **clunky** next to the
Lovable prototype's **exquisite** feel. Root cause is not the concept — the app already uses a
serif (`Fraunces`/`Source Serif 4`) and a navy palette (`navy-trust`, ADR-038). It's the
**craft**: a warm low-contrast serif at bold weight, `600`/`700` label/button weights
everywhere, filled chip controls, untracked uppercase labels, tight spacing, and dim
secondary/border colors that recede into the navy ground.

## Goal

A single, cohesive **"Studio"** visual identity — high-contrast editorial serif, light body,
tracked muted micro-labels, ghost controls, one warm-gold accent, generous air — applied
**app-wide** (chrome + reader + compiler exports), in **two themes**: navy-dark (identity) and
a matching refined-light.

## Locked decisions (brainstorming 2026-08-08)

1. **Scope = full app-wide re-skin** — app chrome, reader (chrome + reading surface), and the
   Node EPUB3/PDF **compiler exports**. Phased (below); one spec would be too large.
2. **Two themes only: `studio-dark` (default identity) + `studio-light`.** The 4 exotic
   palettes (`manuscript`, `reading`, `gilded-noir`, `forest-moss`) and the old `study`/
   `navy-trust` are **retired from the switcher** and removed once no surface depends on them.
   The **dyslexic font toggle + a11y contrast gate stay**.
3. **Display/heading face = Playfair Display** (400 display, 500 sub-heads), negative tracking
   at large sizes. Replaces Source Serif 4 (default) and Fraunces (SME) as THE heading brand.
4. **Body = Inter**, 400 default, 500 for emphasis. **`600`/`700` retired as the default UI
   weight** (the "thick" culprit).
5. **Micro-labels** (uppercase eyebrows / kind labels) = Inter 500, `letter-spacing ≈ .14em`,
   muted color.
6. **Controls**: one gold **filled pill** for the single primary action per view; everything
   else **ghost/hairline** (border, no fill). Tabs = a thin accent underline only.
7. **Contrast discipline** (the user's key note): the deep navy ground stays (it absorbs
   light well); the **foreground is lifted forward** — brighter text (esp. secondary/muted)
   and **brighter hairline borders**. Same discipline applied to the light theme.
8. **Reader book PAGE + compiler exports change too** (P3/P4) — but authored content keeps its
   own semantics; the re-skin tunes the *typographic system*, not the author's words.

## Token architecture (why this is mostly a value swap)

The app already has the machinery:
- **`src/constants/theme.ts`** — `colors` shape (the token keys: `background`, `surface`,
  `surfaceHigh`, `border`, `borderLight`, `text`, `textSecondary`, `textMuted`, `primary`,
  `primaryText`, `brand`, `brandText`, `growth`, `growthText`, `tile*`, `success`, `error`,
  `warning`, `white`) + a `themes` registry + `THEME_META`. A palette = one object of that shape.
- **`ThemeProvider` / `themeStore`** — selects a palette; `useThemedStyles` consumes it.
- **`src/constants/fonts.ts` + `src/lib/applyGlobalFont.ts`** — a global text interceptor maps
  each `fontWeight` → a concrete bundled family per role (`body`→Inter, `heading`→Source Serif 4
  / Fraunces), so we do **not** hand-edit the ~120 `fontWeight` sites to change the heading face.

So the re-skin is: **(a)** two new palettes on the same token shape, **(b)** Playfair added to
the heading resolver and made the app-wide heading brand, **(c)** component-level craft
(weights→400/500, filled→ghost, +tracking, +spacing) rolled out via shared primitives.

### Palette — `studio-dark` (the identity)

RN palettes use solid hex (no rgba); the mockup's rgba borders are given as their solid blend
over the ground.

| key | value | note |
|---|---|---|
| `background` | `#0A0E1A` | deep navy ground (light-absorbing) |
| `surface` | `#131E36` | card |
| `surfaceHigh` | `#1B2842` | raised |
| `border` | `#323846` | hairline, **lifted** (≈ rgba(210,224,247,.20) over ground) |
| `borderLight` | `#4E5565` | strong hairline (≈ .34) |
| `text` | `#F4F7FC` | near-white, **forward** |
| `textSecondary` | `#C6D4EC` | **lifted** (was `#9AA3C0`-class) |
| `textMuted` | `#93A6C6` | **lifted** — labels still read |
| `primary` / `brand` / `growth` | `#F0DCAC` | single warm-gold accent (collapse, like navy-trust) |
| `primaryText`/`brandText`/`growthText` | `#0A0E1A` | ink on gold |
| `error` | `#E29B9B` · `success` `#8FCBAD` · `warning` `#E7C98A` | desaturated to sit in navy |
| `tileOffFace` `#131E36` · `tileOffGlyph` `#F0DCAC` · `tileOnFace` `#F0DCAC` · `tileOnGlyph` `#0A0E1A` | nav tiles |

### Palette — `studio-light` (daylight / a11y)

| key | value |
|---|---|
| `background` `#F7F5F0` · `surface` `#FFFFFF` · `surfaceHigh` `#FAF8F2` |
| `border` `#CDCDCA` · `borderLight` `#B2B2B1` (darkened for contrast) |
| `text` `#0C111B` · `textSecondary` `#3C495D` · `textMuted` `#6C7A8F` |
| `primary`/`brand`/`growth` `#8A6A22` (gold, darkened for contrast on light) · ink `#FFFFFF` |
| `error` `#9C4A48` · `success` `#356E56` · `warning` `#8A6A22` |

Both palettes **must pass the existing a11y contrast gate** (`src/theme/contrast.ts`) for
`text`/`textSecondary` on `background`/`surface`.

### Type system

| role | face | weights | notes |
|---|---|---|---|
| Display / headings | **Playfair Display** | 400 (display ≥20px), 500 (small heads) | negative tracking (`-0.01em`) at large sizes; **never bold** for the display look |
| Body / UI | **Inter** | 400 default, 500 emphasis | retire 600/700 as the default weight |
| Micro-label | Inter 500 | — | `text-transform:uppercase`, `letter-spacing ≈ .14em`, `textMuted` |
| Mono | JetBrains/Menlo | — | unchanged (BYOK key / code) |

`fonts.ts`: add `PlayfairDisplay_400Regular` / `_500Medium` (+ `600` for weight-bucket
completeness) to `FONT_ASSETS`; add a `PLAYFAIR` family map; make `resolveFamily(role:"heading")`
return Playfair (retire the `serif`/`fraunces` brand split, or repoint both to Playfair).
Dependency already installed: `@expo-google-fonts/playfair-display`.

### Control + spacing language

- **Primary** = one gold filled pill per view (`primary` bg, `primaryText`). **Secondary/most** =
  ghost: `borderLight` 1px, transparent bg, `text`. Tabs = 1.5px `primary` underline on active only.
- Card = `surface` + `border` hairline, `radius.lg`, roomy padding.
- Spacing: increase vertical rhythm (section gaps, card padding) — the mockup's air is the target.

## Decomposition (phased sub-projects — each its own spec→plan→SDD→ship)

| Phase | Scope | Boundary / why separable |
|---|---|---|
| **P0 Foundations** | Bundle Playfair + heading resolver → Playfair; add `studio-dark`+`studio-light` palettes; make `studio-dark` default; trim the theme switcher to the two (+ dyslexic); keep old palettes only where a not-yet-migrated surface still hard-depends on one | Ships behind the theme switch; verified by theme tests + contrast gate; no per-screen visual sweep yet |
| **P1 Primitives + SME** | Shared primitives — `Button`/`Chip`/`Label`/`Card`/`PhaseTabBar` — adopt ghost+tracked+Playfair+weight-reduction; apply across the **SME/Projects** surfaces (Projects list, `[projectId]`, Reviews, trust/new) | Immediate payoff on the screens under test; primitives are the reuse vehicle for P2 |
| **P2 App chrome** | Library, Books, Settings, nav, Help/About adopt P1 primitives + tokens | Pure sweep over P1 |
| **P3 Reader** | Reader chrome + navy reading surface (night) | Isolated surface; guard authored-content typography |
| **P4 Compiler exports** | EPUB3/PDF compile typography (separate `compiler/` pipeline) | Touches the shipped artifact — most careful, last, its own spec |

**This spec covers the full vision; the first implementation plan is P0 + P1** (the first
shippable, user-visible slice). P2–P4 each get their own spec/plan when P0+P1 land.

## P0 + P1 — what the first plan builds

**P0 (foundations, token layer):**
1. `fonts.ts`: add Playfair to `FONT_ASSETS` + `PLAYFAIR` map; `resolveFamily` heading→Playfair;
   `applyGlobalFont` recognises Playfair as heading-intent (like the existing Fraunces branch).
2. `theme.ts`: add `studioDarkColors` + `studioLightColors` (exact hex above); register in
   `themes` + `THEME_META` (`studio-dark`→dark, `studio-light`→light).
3. `themeStore`: default → `studio-dark`; switcher list → `["studio-dark","studio-light"]`.
   Old palettes remain **defined** (not deleted) until P2/P3 migrate their last consumer —
   audit consumers (esp. the reader's `reading`/sepia) before removing from the registry.
4. Contrast gate: assert both new palettes pass `contrast.ts` thresholds.

**P1 (primitives + SME surfaces):**
5. Introduce/upgrade shared primitives to the Studio language:
   - `Label` (tracked uppercase micro-label), `Button` (variant `primary`=gold pill /
     `ghost`=hairline; retire inline filled `approveBtn`/`compareBtn` styles in favor of it),
     `Card` (hairline surface), `Chip`, and align `PhaseTabBar` to the underline-only active.
6. Migrate the SME/Projects screens (`app/(tabs)/projects`, `app/trust/[projectId]`,
   `app/(tabs)/reviews`, `app/trust/new`) to the primitives + Playfair titles + 400/500 weights.
   Titles use Playfair via the heading role; kill literal `fontWeight:"700"/"600"` on labels/buttons.

## Testing

- **P0:** unit — `resolveFamily("heading", w)` → Playfair family per weight; `studio-dark`/
  `studio-light` present in `themes` with all token keys; `contrast.ts` passes for both.
  `applyGlobalFont` routes a Playfair family as heading (+ still yields to dyslexic).
- **P1:** RNTL — primitives render the right variant (ghost has no fill / primary is gold);
  a migrated SME screen renders titles in Playfair family and has no `fontWeight:"700"` in its
  computed styles for labels/buttons; existing SME tests stay green (snapshot/label-based, not
  color-literal).
- Device: verify on the emulator (mobile/`verify` skill) that Playfair loads on native and the
  navy contrast reads (fonts are native-bundled, not CDN).

## Rollout

Mobile-only for P0+P1 (no backend). Web redeploy + APK when shipping. P4 (compiler) later,
separately. Default theme flips to `studio-dark` — call out in the PR (existing users see the
new look; the switcher offers `studio-light`).

## Risks / out of scope

- **Playfair legibility <20px** — use Inter for small UI text; Playfair only for headings/titles
  (mockup already does this).
- **Removing palettes could break a surface** — P0 does NOT delete old palettes, only trims the
  switcher + flips the default; deletion is per-phase after consumer audit.
- **Reader authored content** (P3) and **exports** (P4) are **out of scope for P0+P1** — named
  here only for the roadmap.
- No color-literal assertions in tests (they break on a re-skin) — assert structure/role.

## Files (P0 + P1)

**P0:** `mobile/src/constants/fonts.ts`, `mobile/src/lib/applyGlobalFont.ts`,
`mobile/src/constants/theme.ts`, `mobile/src/theme/themeStore.ts` (+ theme switcher UI in
Settings), tests under `mobile/__tests__/theme|lib`.
**P1:** `mobile/src/components/` (Button/Chip/Label/Card/PhaseTabBar primitives),
`mobile/app/(tabs)/projects.tsx`, `mobile/app/trust/[projectId].tsx`,
`mobile/app/(tabs)/reviews.tsx`, `mobile/app/trust/new.tsx`, tests under `mobile/__tests__/`.
