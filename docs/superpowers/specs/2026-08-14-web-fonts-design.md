# Web fonts render as system fonts — fix — Design

**Status:** Approved (brainstorming, 2026-08-14). Bug: the deployed **web** app renders in OS **system
fonts**, not the intended **Inter** (body) + **Fraunces/Source Serif** (headings). Native (APK) is fine.

## Root cause (verified live on `mambakkam.net/app/mentible`)

Two compounding issues:
1. **`applyGlobalFont` no-ops on web** (`src/lib/applyGlobalFont.ts:127` — `if (Platform.OS === "web") return;`).
   That interceptor is what assigns Inter to un-styled `Text` on native; on web it never runs, so un-styled
   Text falls back to react-native-web's system-font default (`-apple-system, …`). Live probe: the "Sign in"
   heading + all body text compute to `-apple-system`; `Inter_*` @font-faces are `unloaded` (unused).
2. **The theme's web font *stacks* reference canonical families that aren't registered.**
   `theme.fontBody` (web) = `"Inter, system-ui, …"` and `theme.fontHeading` (web) = `"'Source Serif 4', …
   serif"`, but `useFonts(FONT_ASSETS)` registers the fonts **per-weight** — `Inter_400Regular`,
   `Fraunces_700Bold`, `SourceSerif4_600SemiBold` — NOT a family named `Inter`/`Source Serif 4`. So even the
   sites that *do* use `fontBody`/`fontHeading` (`paywall.tsx`, `usage.tsx`) get a system fallback; and only
   text with an explicit registered per-weight family (the "MENTIBLE" wordmark → `Fraunces_600SemiBold`, the
   new-project heading → `FRAUNCES.bold`) actually renders the brand font.

Net: on web, everything except a couple of explicit-family strings is a system font.

## Fix (web only; native untouched)

Register **canonical, weight-synthesizing** font families on web and make Inter the default text font, so the
theme's existing `fontBody`/`fontHeading` stacks resolve and un-styled Text inherits Inter.

1. **`src/lib/webFonts.web.ts`** (a `.web.ts` so it's tree-shaken off native) exporting `registerWebFonts()`:
   inject a `<style>` (once) with `@font-face` rules declaring the canonical families from the ALREADY-imported
   font-module asset URIs (resolve each module via `Asset.fromModule(mod).uri` from `expo-asset`, or the
   module's web URI):
   - `Inter` → weights 400/500/600/700 (from `Inter_400Regular`…`Inter_700Bold`);
   - `Fraunces` → 400/600/700 (+ italic 400/600 → `font-style: italic`);
   - `Source Serif 4` → 400/600/700;
   - `OpenDyslexic` → its bundled weights (a11y).
   Each `@font-face { font-family: <canonical>; font-weight: <n>; font-style: <normal|italic>; src: url(<uri>)
   format("truetype"); font-display: swap; }`. The browser then synthesizes weight from a single family.
   A native stub `src/lib/webFonts.ts` exports a no-op `registerWebFonts()`.
2. **Default text font = Inter.** In the same injected stylesheet, set the app's base text font so
   react-native-web `Text` without an explicit family renders **Inter** (e.g. a rule on the app root that RNW
   text inherits — the implementer confirms the exact selector against a local web build; success = computed
   `font-family` on body text is `Inter`, not `-apple-system`). Explicit families (Fraunces/Source-Serif
   heading styles, icon fonts, monospace) must still win — do NOT `!important`-override them.
3. **Call it on web** from `app/_layout.tsx` alongside `applyGlobalFont()` (which stays native-only), guarded
   so native is unaffected. Order: after `useFonts` has the modules available (the URIs resolve regardless;
   `font-display: swap` covers the load).

The theme tokens already name `Inter` / `Source Serif 4` / `Fraunces`; this fix makes those names real on web.
No change to the ~120 style sites, no change to `applyGlobalFont`'s native path.

## Scope / known partial

- **Headings that rely on the native interceptor** (no explicit family — e.g. a stray "Sign in") render the
  default **Inter (sans)** on web after this fix, not the serif — the interceptor's "large+bold → serif"
  heuristic is native-only. That's an improvement (was system-sans; now brand-sans) and most app headings
  already set an explicit Fraunces/Playfair family (Studio re-skin migrated them → they render serif once the
  canonical families exist). Migrating any straggler heading to an explicit family is a separate follow-up.

## Testing / verification (MANDATORY — the shared browser is unreliable for me)

- **Unit:** `registerWebFonts()` injects a `<style>` containing `@font-face` for `Inter`/`Fraunces`/
  `Source Serif 4` with the expected weights (jsdom: assert the stylesheet text). The native stub is a no-op.
- **Real web render (the gate):** the implementer builds/serves the web app locally (`npx expo start --web`
  or `expo export -p web` + serve) and, on a rendered page, reads `getComputedStyle` on: a body text node →
  `font-family` resolves to **Inter** (and `document.fonts` shows an `Inter` face `loaded`); an explicit
  Fraunces heading (the wordmark) → still `Fraunces`. Record the before/after computed values in the report.
  Do NOT mark done until body text is Inter on a real web render.

## Rollout

Web deploy only (native unaffected — no APK needed for this fix; the APK already renders correctly). No
backend, no migration. After deploy I re-probe the live page's computed fonts (clean browser) to confirm.

## Global constraints

- Native path (`applyGlobalFont`) unchanged; the fix is `.web`-scoped. Don't `!important`-clobber explicit
  families (icons/monospace/Fraunces headings must survive). Mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
