# Lovable background (cream + gold gradient) — Design

**Status:** Approved (brainstorming, 2026-08-14). Make the app background match the Lovable prototype: a
light **cream** default with a subtle **gold-tinted top→bottom gradient**, both themes, app-wide.

## Current state

- Default theme is hardcoded **`studio-dark`** (`ThemeProvider.tsx` `useState("studio-dark")` + the
  `ThemeContext` default + `themeStore.loadThemeName` default). `studioLightColors` bg = `#F7F5F0` (warm
  cream, close to Lovable's `oklch 0.985`); `studioDarkColors` bg = `#0A0E1A` (navy); shared gold accent
  `#D6A94B` (≈ Lovable `--gold: oklch 0.75 0.13 80`).
- Background is **flat** — **56 sites** (`grep "backgroundColor: (c|theme|colors)\.background"` across
  `mobile/app` + `mobile/src/components`) paint the full-screen fill on a screen's outer `scroll`/root View.
- Web: `html/body/#root` are **transparent** (white behind) — the fonts-bug's sibling.
- Lovable's bg gradient (its `body`): `linear-gradient(180deg, background 0%, color-mix(in oklab,
  background 85%, gold 15%) 100%)` — subtle, warms toward gold at the bottom.

## Decisions (from brainstorming)

- **Default → `studio-light`** (cream), like Lovable; dark stays a Settings choice.
- **Subtle gold gradient, BOTH themes**, app-wide (light: cream→warm-cream; dark: navy→warm-navy).
- **Fix the transparent web root** so nothing white bleeds.

## Architecture

Sequence into two slices so the high-value/low-risk part lands independently of the riskier gradient.

### Slice A — default cream + root-fill (low risk, ~95% of the visible match)
1. **Default theme = `studio-light`:** flip the `ThemeProvider` `useState` initial, the `ThemeContext`
   default `theme`/`themeName`, and any `loadThemeName` fallback, from `"studio-dark"` → `"studio-light"`.
   Keep the Settings switcher + persistence intact (a persisted choice still wins). Native + web.
2. **Web root-fill:** in the web font module (`webFonts.web.ts`, already injects a `<style>`) or a sibling,
   set `html, body, #root { background-color: <studio-light bg>; }` so the page ground is the theme bg, not
   white. (Static value is fine — the app repaints per-theme; this is just the first-paint/overscroll ground.)

### Slice B — the gold gradient (app-wide; the 56-fill change)
3. **Palette token `bgGradientEnd`** on each palette: `bgGradientEnd = mix(background, "#D6A94B", 0.15)`
   (a small `mix(hexA, hexB, t)` util in `theme.ts`). `studio-light`/`studio-dark` get it; other palettes
   may set `bgGradientEnd = background` (flat, unchanged).
4. **Root gradient layer:** add `expo-linear-gradient` (new dep). A shared `AppBackground` wrapper (or in
   `app/_layout.tsx`) renders `<LinearGradient colors={[theme.background, theme.bgGradientEnd]} start={{x:0,y:0}}
   end={{x:0,y:1}} style={{flex:1}}>` behind the `Stack`, and the `Stack` `screenOptions.contentStyle`
   becomes `backgroundColor: "transparent"`.
5. **Screen fills → transparent (codemod):** the 56 outer full-screen fills `backgroundColor: c.background`
   (the `scroll`/root `flex:1` container of each screen) → `backgroundColor: "transparent"` so the root
   gradient shows through. **ONLY the outer full-screen fill** — do NOT touch `c.surface`/`c.surfaceHigh`/
   card/modal/tile backgrounds (those stay opaque). Verify each changed site is an outer screen container,
   not a card. `app/_layout.tsx:41`'s loading View keeps its solid bg (it's pre-gradient).

## Testing / verification

- **Slice A:** unit — `ThemeProvider`/context default is `studio-light`; the Settings switcher still switches
  + persists; a persisted `studio-dark` still loads dark. Web: `registerWebFonts`/the web style now includes
  the root background rule (jsdom assert).
- **Slice B:** unit — `mix()` correctness; `bgGradientEnd` present on studio palettes. **Real render (the
  gate):** build/serve web (`expo export -p web` → serve) and, via Playwright, screenshot the light + dark
  themes on 2–3 screens (Library, a form, a trust screen) — confirm the cream/navy gradient shows, no white
  bleed, and no screen looks broken (a card/modal that went unexpectedly transparent). Record before/after
  screenshots. Native: a device or emulator smoke isn't required, but confirm `LinearGradient` imports don't
  break the native build (`expo export -p ios`/tsc).
- No color-literal asserts in RNTL (existing tests don't assert bg colors — the 56-fill change is test-safe).

## Rollout

Web deploy + APK (theme change affects both). I re-probe the live web (computed bg + light/dark screenshots)
after deploy.

## Global constraints

- Keep the theme switcher + persistence. Only the OUTER full-screen fill goes transparent — never surface/
  card/tile. `mix()` clamps + validates hex. Mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`.
  Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Out of scope

- Reworking the palettes' colors beyond the cream default + gradient end. Per-screen bespoke backgrounds.
