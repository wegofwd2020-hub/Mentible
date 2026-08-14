# Lovable background (cream + gradient) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app opens on the light **cream** theme with a subtle **gold gradient** background (both themes), matching the Lovable prototype; no white bleed on web.

**Architecture:** Slice A — flip the default theme to `studio-light`, fix the web root background, correct the status-bar/static-`colors`. Slice B — add `expo-linear-gradient`, a `bgGradientEnd` palette token, a root gradient layer behind the Stack, and codemod the 56 outer full-screen fills to transparent so the gradient shows.

**Tech Stack:** React Native (Expo) + react-native-web; `expo-linear-gradient`; Jest + RNTL; a web render (Playwright) for the Slice-B gate.

## Global Constraints

- Keep the theme switcher + persistence (a persisted choice still wins; only the DEFAULT flips). Slice B touches ONLY the outer full-screen fill (`scroll`/root `flex:1` container) — NEVER `c.surface`/`c.surfaceHigh`/card/modal/tile backgrounds. `mix()` validates/clamps.
- No color-literal asserts in RNTL. Mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `themes` registry (`theme.ts:284`) has `"studio-light"`/`"studio-dark"`; `studioLightColors.background = "#F7F5F0"`, `studioDarkColors.background = "#0A0E1A"`, shared gold `#D6A94B`. `ThemeProvider.tsx`: `ThemeContext` default `theme: themes["studio-dark"]`/`themeName:"studio-dark"` + `useState<ThemeName>("studio-dark")`. `themeStore.loadThemeName` returns null on miss → provider falls back to its default. `_layout.tsx`: a static `colors` import used at `:41` (loading View bg) + `:54` (`contentStyle.backgroundColor`); `StatusBar style="light"`; `ThemeProvider` wraps `Stack`. `webFonts.web.ts` already injects a `<style id="mentible-web-fonts">`. `useTheme()` from `@/theme`.

---

### Task 1 (Slice A): Default to cream + web root-fill + status bar

**Files:**
- Modify: `mobile/src/theme/ThemeProvider.tsx` (defaults), `mobile/app/_layout.tsx` (static `colors` → light bg + StatusBar), `mobile/src/lib/webFonts.web.ts` (root bg rule)
- Test: `mobile/__tests__/theme/*` (provider default) + `mobile/__tests__/lib/webFonts.test.ts` (root bg rule)

- [ ] **Step 1: Failing test.** (a) Provider: render `ThemeProvider` + a probe using `useTheme()`; assert `themeName === "studio-light"` by default (no persisted value); and that `setTheme("studio-dark")` still switches (persistence mocked). (b) webFonts: assert the injected `<style>` now contains a rule setting `html, body, #root { background-color: #F7F5F0 }` (studio-light bg).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Flip the default.** In `ThemeProvider.tsx`: `ThemeContext` default → `themes["studio-light"]` / `"studio-light"`; `useState<ThemeName>("studio-light")`. (Persisted `studio-dark` still loads via the existing `loadThemeName` effect.)
- [ ] **Step 4: `_layout.tsx`.** The static `colors` at `:41`/`:54` — if `colors` is the dark palette, switch the loading-View bg + `contentStyle` to the **studio-light** background (import `studioLightColors` or the light bg) so first paint + the Stack ground are cream, not navy. Change `StatusBar style="light"` → `style="dark"` (dark icons on the light ground). (If you prefer theme-reactive, that's fine too, but a static light default is acceptable per the spec.)
- [ ] **Step 5: Web root-fill.** In `webFonts.web.ts`, append to the injected stylesheet: `html, body, #root { background-color: #F7F5F0; }` (studio-light bg) so the web page ground isn't white.
- [ ] **Step 6: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Commit:
```bash
git add mobile/src/theme/ThemeProvider.tsx "mobile/app/_layout.tsx" mobile/src/lib/webFonts.web.ts mobile/__tests__
git commit -m "feat(theme): default to the light (cream) studio theme + paint the web page ground (was navy default / white root)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2 (Slice B): Gold gradient background + transparent screen fills

**Files:**
- Modify: `mobile/src/constants/theme.ts` (`mix()` + `bgGradientEnd` on palettes), `mobile/app/_layout.tsx` (root gradient + transparent contentStyle), + the **56** screen files with an outer `backgroundColor: c.background` fill
- Add dep: `expo-linear-gradient`
- Create: `mobile/src/components/AppBackground.tsx` (the gradient wrapper)
- Test: `mobile/__tests__/` (mix() + AppBackground) + a real web render (Playwright, recorded)

- [ ] **Step 1: `mix()` + tokens (failing test first).** Add `mix(hexA: string, hexB: string, t: number): string` to `theme.ts` (parse `#rrggbb`, clamp `t∈[0,1]`, per-channel lerp, return `#rrggbb`). Test: `mix("#000000","#ffffff",0.5) === "#808080"` (±1), invalid hex throws or returns hexA. Add `bgGradientEnd: mix(background, "#D6A94B", 0.15)` to `studioLightColors` + `studioDarkColors` (add the field to the `Palette` type, optional → defaults to `background` where unset; set it = `background` on the other palettes so they stay flat).
- [ ] **Step 2: Install** `npx expo install expo-linear-gradient`.
- [ ] **Step 3: `AppBackground.tsx`.** `export function AppBackground({ children })`: `const t = useTheme();` → `<LinearGradient colors={[t.background, t.bgGradientEnd ?? t.background]} start={{x:0,y:0}} end={{x:0,y:1}} style={{ flex: 1 }}>{children}</LinearGradient>`.
- [ ] **Step 4: Wire into `_layout`.** Wrap the `Stack` in `<AppBackground>` (inside `ThemeProvider`/`AuthProvider` so it reads the theme). Change the Stack `screenOptions.contentStyle` to `{ backgroundColor: "transparent" }`.
- [ ] **Step 5: Codemod the 56 outer fills.** For each screen file where the OUTER full-screen container sets `backgroundColor: c.background` (the `scroll`/root `flex:1` style — e.g. `new.tsx:122`, `paywall.tsx:189`, `account.tsx:245`, …), change it to `backgroundColor: "transparent"`. Do this ONLY for the outer screen fill — leave `c.surface`/`c.surfaceHigh`/card/modal/tile backgrounds untouched. Grep: `grep -rn "backgroundColor: \(c\|theme\|colors\)\.background\b" mobile/app mobile/src/components` and change each site that is a screen's outer container (verify by reading the surrounding style key: `scroll`/`container`/`screen`/`root`, NOT `card`/`surface`/`modal`/`sheet`/`tile`). `_layout.tsx:41`'s pre-gradient loading View KEEPS its solid light bg. Record the count changed vs skipped.
- [ ] **Step 6: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Confirm native build imports resolve: `npx expo export -p web` succeeds (and `tsc` covers native types).
- [ ] **Step 7: REAL web-render verify (the gate).** `npx expo export -p web` → serve `dist` → Playwright: load Library (light default) → screenshot; toggle to dark (via Settings or seeding the theme store) → screenshot; load a form screen + a trust screen. Confirm: the cream/navy **gradient shows** (bottom warmer), **no white bleed**, and **no screen looks broken** (no card/modal gone unexpectedly transparent). Save before/after screenshots to the report. Do NOT mark done until light+dark render correctly with no broken surface.
- [ ] **Step 8: Commit**
```bash
git add mobile/src/constants/theme.ts mobile/src/components/AppBackground.tsx "mobile/app/_layout.tsx" mobile/app mobile/src mobile/package.json mobile/package-lock.json mobile/__tests__
git commit -m "feat(theme): subtle gold gradient app background; screen fills transparent so it shows (both themes)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`; `npx expo export -p web` succeeds.
- [ ] Default = cream; both themes show the subtle gradient; no white bleed; no broken (unexpectedly transparent) card/modal — verified on a real render, light + dark, ≥3 screens (screenshots recorded).
- [ ] Theme switcher + persistence intact; a persisted `studio-dark` still opens dark.
- [ ] **Deploy:** web deploy + APK. I re-probe the live web (computed bg + light/dark screenshots).

## Out of scope

- Palette color rework beyond the gradient end. Per-screen bespoke backgrounds. Native device screenshot verify (web render is the gate; native parity is by construction via the shared `AppBackground`).
