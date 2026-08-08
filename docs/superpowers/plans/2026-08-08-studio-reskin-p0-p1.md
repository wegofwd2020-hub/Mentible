# Studio Re-skin — P0 (foundations) + P1 (primitives + SME) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first shippable slice of the Studio re-skin — the two Studio themes + Playfair heading face (P0), and the shared ghost/tracked primitives applied to the SME/Projects surfaces (P1).

**Architecture:** A value-swap onto the existing palette token shape (`src/constants/theme.ts`) + one heading-font change in the global font resolver (`src/constants/fonts.ts` / `applyGlobalFont.ts`), then new shared primitives (`Label`/`Button`/`Card`/`Chip`) that the SME screens adopt. No backend.

**Tech Stack:** React Native + Expo (TypeScript strict), Jest + RNTL, `@expo-google-fonts/{inter,playfair-display}`, existing `ThemeProvider`/`useThemedStyles`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-08-studio-reskin-design.md` — exact palette hex + type policy live there; use those values verbatim.
- **Two themes:** `studio-dark` (default) + `studio-light`. Old palettes stay **defined** (not deleted) but are removed from the Settings switcher. Dyslexic toggle untouched.
- **Playfair Display** = heading face (400 display / 500 small); **Inter** body 400/500. **Retire `600`/`700` as the default UI weight** on labels/buttons.
- Micro-labels: Inter 500, `letterSpacing` ≈ `0.14 * fontSize` px on native (RN takes px, not em), uppercase, muted color.
- Both palettes MUST pass `contrastRatio(text, background) >= 4.5` and `>= 4.5` for `textSecondary` on `surface` (WCAG AA body).
- **No color-literal assertions in tests** — assert role/structure/family, never a hex (a re-skin would break those).
- Playfair only for headings/titles (≥16px); never for small UI text (legibility).
- `npx tsc --noEmit` strict clean + full `npx jest` green after every task. Run `npm run lint` if present.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/constants/fonts.ts` — add Playfair family map + heading resolver → Playfair (P0/T1)
- `mobile/src/lib/applyGlobalFont.ts` — recognise Playfair as heading-intent (P0/T1)
- `mobile/src/constants/theme.ts` — `studioDarkColors` + `studioLightColors` + registry (P0/T2)
- `mobile/src/theme/ThemeProvider.tsx` — default → `studio-dark` (P0/T3)
- `mobile/src/constants/theme.ts` — `SWITCHABLE_THEMES` list (P0/T3)
- `mobile/app/(tabs)/settings.tsx` — switcher iterates `SWITCHABLE_THEMES` (P0/T3)
- `mobile/src/components/ui/Label.tsx`, `Button.tsx`, `Card.tsx`, `Chip.tsx` — primitives (P1/T4)
- `mobile/src/components/PhaseTabBar.tsx` — underline-only active (P1/T5)
- `mobile/app/trust/[projectId].tsx`, `mobile/app/(tabs)/projects.tsx` — adopt primitives (P1/T6)
- `mobile/app/(tabs)/reviews.tsx`, `mobile/app/trust/new.tsx` — adopt primitives (P1/T7)

---

### Task 1: Playfair heading face in the font resolver (P0)

**Files:**
- Modify: `mobile/src/constants/fonts.ts`, `mobile/src/lib/applyGlobalFont.ts`
- Test: `mobile/__tests__/lib/fonts.playfair.test.ts` (new)

**Interfaces:**
- Produces: `PLAYFAIR` family map (`regular`/`medium`/`semibold`/`bold` → `PlayfairDisplay_*`); `resolveFamily("heading", w, false)` returns a `PlayfairDisplay_*` family; `FONT_ASSETS` includes the Playfair faces.

- [ ] **Step 1: Write the failing test** (`mobile/__tests__/lib/fonts.playfair.test.ts`):
```ts
import { resolveFamily, FONT_ASSETS } from "@/constants/fonts";

it("heading role resolves to Playfair per weight bucket", () => {
  expect(resolveFamily("heading", "400", false)).toBe("PlayfairDisplay_400Regular");
  expect(resolveFamily("heading", "500", false)).toBe("PlayfairDisplay_500Medium");
  expect(resolveFamily("heading", "700", false)).toBe("PlayfairDisplay_600SemiBold");
  // body unchanged
  expect(resolveFamily("body", "400", false)).toBe("Inter_400Regular");
  // dyslexic still overrides heading
  expect(resolveFamily("heading", "400", true)).toBe("OpenDyslexic_400Regular");
});

it("Playfair faces are registered for useFonts", () => {
  expect(FONT_ASSETS).toHaveProperty("PlayfairDisplay_400Regular");
  expect(FONT_ASSETS).toHaveProperty("PlayfairDisplay_500Medium");
});
```

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/lib/fonts.playfair.test.ts` → FAIL (no Playfair).

- [ ] **Step 3: Add Playfair to `fonts.ts`**
- Import the faces:
```ts
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
} from "@expo-google-fonts/playfair-display";
```
- Add them to `FONT_ASSETS` (alongside the others).
- Add the map (Playfair ships no distinct medium-vs-regular problem here; map medium→500):
```ts
export const PLAYFAIR = {
  regular: "PlayfairDisplay_400Regular",
  medium: "PlayfairDisplay_500Medium",
  semibold: "PlayfairDisplay_600SemiBold",
  bold: "PlayfairDisplay_600SemiBold",
} as const;
```
- In `resolveFamily`, make the heading role return Playfair (retire the `serif`/`fraunces` brand split for the DEFAULT; keep `SERIF`/`FRAUNCES` maps defined so any literal references still resolve until P1 migrates them):
```ts
  if (role === "heading") return PLAYFAIR[b];
```
(The `brand` param becomes unused for the default path; leave the param for signature stability, or drop it and update the 1–2 callers — the implementer chooses the lower-churn option and notes it.)

- [ ] **Step 4: Recognise Playfair in `applyGlobalFont.ts`** — mirror the existing `FRAUNCES_RE` branch so a literal `PlayfairDisplay_*` family is treated as heading-intent (and still yields to dyslexic). Add:
```ts
const PLAYFAIR_RE = /playfair/i;
```
and in the family-resolution block, before the generic serif test:
```ts
    if (PLAYFAIR_RE.test(flat.fontFamily)) {
      if (dyslexic) return resolveFamily("heading", flat.fontWeight, true);
      return flat.fontFamily;
    }
```

- [ ] **Step 5: Run test + tsc** — `npx jest __tests__/lib/fonts.playfair.test.ts && npx tsc --noEmit`.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/constants/fonts.ts mobile/src/lib/applyGlobalFont.ts mobile/__tests__/lib/fonts.playfair.test.ts
git commit -m "feat(theme): Playfair Display as the app heading face (P0)"
```

---

### Task 2: `studio-dark` + `studio-light` palettes (P0)

**Files:**
- Modify: `mobile/src/constants/theme.ts`
- Test: `mobile/__tests__/theme/studioPalettes.test.ts` (new)

**Interfaces:**
- Produces: `studioDarkColors`, `studioLightColors` (both `Palette`); `themes["studio-dark"]`, `themes["studio-light"]`; `THEME_META` entries (`studio-dark`→dark, `studio-light`→light).

- [ ] **Step 1: Write the failing test** (`mobile/__tests__/theme/studioPalettes.test.ts`):
```ts
import { themes, THEME_META, colors } from "@/constants/theme";
import { contrastRatio } from "@/theme/contrast";

const KEYS = Object.keys(colors) as (keyof typeof colors)[];

it("studio-dark and studio-light are registered with the full token shape", () => {
  for (const name of ["studio-dark", "studio-light"] as const) {
    expect(themes[name]).toBeDefined();
    for (const k of KEYS) expect(themes[name][k]).toMatch(/^#|rgba/);
    expect(THEME_META[name]).toBeDefined();
  }
  expect(THEME_META["studio-dark"].mode).toBe("dark");
  expect(THEME_META["studio-light"].mode).toBe("light");
});

it("both Studio palettes meet WCAG AA for body text", () => {
  for (const name of ["studio-dark", "studio-light"] as const) {
    const p = themes[name];
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.textSecondary, p.surface)).toBeGreaterThanOrEqual(4.5);
  }
});
```

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/theme/studioPalettes.test.ts` → FAIL.

- [ ] **Step 3: Add the palettes to `theme.ts`** — using the exact hex from the design spec §"Palette":
```ts
export const studioDarkColors: Palette = {
  background: "#0A0E1A", surface: "#131E36", surfaceHigh: "#1B2842",
  border: "#323846", borderLight: "#4E5565",
  text: "#F4F7FC", textSecondary: "#C6D4EC", textMuted: "#93A6C6",
  primary: "#F0DCAC", primaryText: "#0A0E1A",
  brand: "#F0DCAC", brandText: "#0A0E1A",
  growth: "#F0DCAC", growthText: "#0A0E1A",
  tileOffFace: "#131E36", tileOffGlyph: "#F0DCAC", tileOffShadow: "#05070E",
  tileOnFace: "#F0DCAC", tileOnGlyph: "#0A0E1A", tileOnHi: "#F7E9C6", tileOnLo: "#B79A5E",
  tileSubGlyph: "#93A6C6",
  success: "#8FCBAD", error: "#E29B9B", warning: "#E7C98A",
  white: "#ffffff",
};

export const studioLightColors: Palette = {
  background: "#F7F5F0", surface: "#FFFFFF", surfaceHigh: "#FAF8F2",
  border: "#CDCDCA", borderLight: "#B2B2B1",
  text: "#0C111B", textSecondary: "#3C495D", textMuted: "#6C7A8F",
  primary: "#8A6A22", primaryText: "#FFFFFF",
  brand: "#8A6A22", brandText: "#FFFFFF",
  growth: "#356E56", growthText: "#FFFFFF",
  tileOffFace: "#FFFFFF", tileOffGlyph: "#8A6A22", tileOffShadow: "#D8D3C7",
  tileOnFace: "#8A6A22", tileOnGlyph: "#FFFFFF", tileOnHi: "#A98A3E", tileOnLo: "#6A4F16",
  tileSubGlyph: "#6C7A8F",
  success: "#356E56", error: "#9C4A48", warning: "#8A6A22",
  white: "#ffffff",
};
```
- Register in `themes`: add `"studio-dark": studioDarkColors, "studio-light": studioLightColors,`.
- Add `THEME_META` entries: `"studio-dark": { label: "Studio", mode: "dark" }, "studio-light": { label: "Studio Light", mode: "light" },`.

- [ ] **Step 4: Run tests + tsc** — `npx jest __tests__/theme/studioPalettes.test.ts && npx tsc --noEmit`. If the AA gate fails for `textSecondary`/`surface`, brighten the offending token slightly (stay in-family) and note the adjusted value in the report.

- [ ] **Step 5: Commit**
```bash
git add mobile/src/constants/theme.ts mobile/__tests__/theme/studioPalettes.test.ts
git commit -m "feat(theme): studio-dark + studio-light palettes, WCAG-AA gated (P0)"
```

---

### Task 3: Default to `studio-dark` + trim the switcher (P0)

**Files:**
- Modify: `mobile/src/theme/ThemeProvider.tsx`, `mobile/src/constants/theme.ts`, `mobile/app/(tabs)/settings.tsx`
- Test: `mobile/__tests__/theme/defaultAndSwitcher.test.tsx` (new)

**Interfaces:**
- Consumes: `themes`, `THEME_META` (T2).
- Produces: `SWITCHABLE_THEMES: ThemeName[] = ["studio-dark","studio-light"]`; ThemeProvider default `themeName` = `"studio-dark"`; Settings renders exactly the switchable themes.

- [ ] **Step 1: Write the failing test** (`defaultAndSwitcher.test.tsx`): render a tiny consumer of `useTheme()` inside `<ThemeProvider>` and assert `themeName === "studio-dark"` before any stored value loads; and assert `SWITCHABLE_THEMES` equals `["studio-dark","studio-light"]` and every entry exists in `themes`.
```ts
import { SWITCHABLE_THEMES, themes } from "@/constants/theme";
it("switcher lists only the two Studio themes, both real", () => {
  expect(SWITCHABLE_THEMES).toEqual(["studio-dark", "studio-light"]);
  for (const n of SWITCHABLE_THEMES) expect(themes[n]).toBeDefined();
});
```
(For the default-theme assertion, render `ThemeProvider` with a probe component that reads `useTheme().themeName` and assert the initial value — mock `themeStore.loadThemeName` to resolve `null` so the default shows.)

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/theme/defaultAndSwitcher.test.tsx`.

- [ ] **Step 3: Implement**
- `theme.ts`: add `export const SWITCHABLE_THEMES: ThemeName[] = ["studio-dark", "studio-light"];`
- `ThemeProvider.tsx`: change the two `"study"` defaults (context default object + `useState<ThemeName>("study")`) to `"studio-dark"`, and the context default `theme: themes.study` → `theme: themes["studio-dark"]`. Update the stale "Study default…" comment.
- `settings.tsx`: replace `const THEME_NAMES = Object.keys(THEME_META) as ThemeName[];` with `const THEME_NAMES = SWITCHABLE_THEMES;` (import `SWITCHABLE_THEMES`). Leave the rest of the swatch UI as-is.

- [ ] **Step 4: Run tests + full suite + tsc** — `npx jest __tests__/theme && npx jest __tests__/screens/Settings* 2>/dev/null; npx tsc --noEmit`. If a Settings test asserted the old 6-swatch count, update it to the 2 switchable themes (note in report — this is correct new behavior, not a weakened test).

- [ ] **Step 5: Commit**
```bash
git add mobile/src/theme/ThemeProvider.tsx mobile/src/constants/theme.ts mobile/app/(tabs)/settings.tsx mobile/__tests__/theme/defaultAndSwitcher.test.tsx
git commit -m "feat(theme): default to studio-dark, trim switcher to the two Studio themes (P0)"
```

---

### Task 4: Shared Studio primitives — Label / Button / Card / Chip (P1)

**Files:**
- Create: `mobile/src/components/ui/Label.tsx`, `Button.tsx`, `Card.tsx`, `Chip.tsx`, `mobile/src/components/ui/index.ts`
- Test: `mobile/__tests__/components/ui/primitives.test.tsx` (new)

**Interfaces:**
- Produces:
  - `Label` — `<Label tone?: "muted"|"secondary" style?>{children}</Label>` → uppercase, tracked, `textMuted` (default) / `textSecondary`.
  - `Button` — `<Button variant: "primary"|"ghost" label: string onPress busy? disabled? accessibilityLabel? />` → `primary` = gold pill (`primary` bg, `primaryText`), `ghost` = hairline (`borderLight` 1px, transparent, `text`). Busy shows `…` and disables.
  - `Card` — `<Card style?>{children}</Card>` → `surface` bg + `border` 1px + `radius.lg` + padding.
  - `Chip` — `<Chip label active? />` → small pill; active uses `primary`.

- [ ] **Step 1: Write the failing test** (`primitives.test.tsx`): render each; assert:
  - `Label` renders uppercased text and has `letterSpacing > 0` in its flattened style.
  - `Button variant="primary"` flattened style `backgroundColor === theme.primary`; `variant="ghost"` has `backgroundColor` transparent/undefined and a `borderWidth` of 1. (Read the active theme via the same `useThemedStyles` the component uses — render inside `ThemeProvider`; assert against `themes["studio-dark"]` role values, NOT a raw hex literal.)
  - `Button busy` → `disabled` truthy and label shows `…`; `onPress` not called when disabled.
  - `Chip active` differs from inactive (has the accent border/!fill).
(Use `toJSON()` + `StyleSheet.flatten`, or query by `accessibilityLabel`/text. No hex literals — pull expected values from `themes["studio-dark"]`.)

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/components/ui/primitives.test.tsx`.

- [ ] **Step 3: Implement the primitives** — each via `useThemedStyles((c) => …)`, using `spacing`/`radius`/`typography` from `@/constants/theme`. Label sets `textTransform:"uppercase"`, `letterSpacing: Math.round(typography.sizeXs * 0.14)`, `fontWeight:"500"`, color per tone. Button: `primary` → `{ backgroundColor: c.primary }` + `{ color: c.primaryText }` text; `ghost` → `{ backgroundColor: "transparent", borderWidth: 1, borderColor: c.borderLight }` + `{ color: c.text }`; both `borderRadius: radius.full`, `paddingVertical: spacing.sm`, `paddingHorizontal: spacing.md`, text `fontWeight:"500"` (NOT 700). Card: `{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.lg }`. Chip: small pill, `active` uses `c.primary` border/text. Export all from `ui/index.ts`.

- [ ] **Step 4: Run test + tsc** — `npx jest __tests__/components/ui/primitives.test.tsx && npx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add mobile/src/components/ui mobile/__tests__/components/ui/primitives.test.tsx
git commit -m "feat(ui): Studio primitives — Label/Button/Card/Chip (ghost + tracked, no bold) (P1)"
```

---

### Task 5: `PhaseTabBar` → underline-only active + Studio type (P1)

**Files:**
- Modify: `mobile/src/components/PhaseTabBar.tsx`
- Test: `mobile/__tests__/components/PhaseTabBar.studio.test.tsx` (new) — extend existing coverage, don't duplicate.

**Interfaces:**
- Consumes: theme tokens. Produces: active tab = a `primary`-colored underline + `text` label; inactive = `textMuted`, no fill.

- [ ] **Step 1: Write the failing test** — render `PhaseTabBar` with a known phase; assert the active tab label color === `theme.text` (or has an underline element) and inactive === `theme.textMuted`; assert NO filled `backgroundColor` on the active tab (underline treatment, not a pill). Pull colors from `themes["studio-dark"]`.

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/components/PhaseTabBar.studio.test.tsx` (fails if the current bar uses a filled active state).

- [ ] **Step 3: Implement** — adjust `PhaseTabBar` styles so active = bottom-border `1.5` in `c.primary` + `c.text` label; inactive = `c.textMuted`, transparent. Keep the existing `PHASE_ORDER`-driven rendering and `onSelect` API unchanged. Labels stay Inter (body) — do not Playfair the tabs.

- [ ] **Step 4: Run PhaseTabBar suite + tsc** — `npx jest PhaseTabBar && npx tsc --noEmit`. Update the existing `PhaseTabBar.test.tsx` only if it asserted the old filled active style (note in report).

- [ ] **Step 5: Commit**
```bash
git add mobile/src/components/PhaseTabBar.tsx mobile/__tests__/components/PhaseTabBar.studio.test.tsx
git commit -m "feat(ui): PhaseTabBar underline-only active (Studio) (P1)"
```

---

### Task 6: Migrate `[projectId]` + Projects list to the Studio primitives (P1)

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`, `mobile/app/(tabs)/projects.tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.studio.test.tsx` (new); existing `TrustProjectDetail.*` stay green.

**Interfaces:**
- Consumes: `ui/*` primitives (T4), `PhaseTabBar` (T5), Playfair heading role (T1).

- [ ] **Step 1: Write the failing test** (`TrustProjectDetail.studio.test.tsx`): render the screen (mock `useTrustProject` like the sibling tests); assert (a) the project title's flattened `fontFamily` matches `/Playfair/` (it currently uses `FRAUNCES.bold`); (b) no button/label in the tree has `fontWeight: "700"` (walk `toJSON()` and assert none of the migrated controls carry `700`). Keep the assertion scoped to the controls you migrate.

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/screens/TrustProjectDetail.studio.test.tsx`.

- [ ] **Step 3: Migrate** — in `[projectId].tsx`:
  - Swap `import { FRAUNCES } from "@/constants/fonts"` heading usages to Playfair: change `title`/`artifactTitle`/`genCardLabel` `fontFamily: FRAUNCES.*` → `PLAYFAIR.bold`/`PLAYFAIR.semibold` (import `PLAYFAIR`). (Or drop the literal family and let the heading role resolve — but these styles set a concrete family for web; keep a concrete `PLAYFAIR.*`.)
  - Replace inline `approveBtn`/`compareBtn`/`viewBtn` Pressables + their `fontWeight:"700"` text styles with `<Button variant="primary"|"ghost">`; replace the uppercase `sourceKindLabel`/eyebrow styles with `<Label>`; wrap source rows / gen cards in `<Card>` where it reduces bespoke style. Keep all behavior/handlers/accessibility labels identical (the Structure `Next`, Suggest, etc. — do not regress Slice B).
  - Remove now-dead style entries (the `fontWeight:"700"` label/button styles you replaced).
  - In `projects.tsx`: title → Playfair; project cards → `<Card>`; the "New project"/primary action → `<Button variant="primary">`; eyebrows → `<Label>`.
- Keep `useThemedStyles`; do not hardcode hex.

- [ ] **Step 4: Run the full TrustProjectDetail + Projects suites + tsc** — `npx jest __tests__/screens/TrustProjectDetail __tests__/screens/Projects 2>/dev/null; npx tsc --noEmit`. All green — the Slice B tests (structure/generate/journey) must still pass unchanged (behavior is untouched; only styling moved to primitives). If a test asserted a bespoke style name that no longer exists, update it to assert behavior/role instead (note in report).

- [ ] **Step 5: Commit**
```bash
git add "mobile/app/trust/[projectId].tsx" "mobile/app/(tabs)/projects.tsx" mobile/__tests__/screens/TrustProjectDetail.studio.test.tsx
git commit -m "feat(trust): Studio re-skin — [projectId] + Projects on primitives + Playfair (P1)"
```

---

### Task 7: Migrate Reviews + trust/new to the Studio primitives (P1)

**Files:**
- Modify: `mobile/app/(tabs)/reviews.tsx`, `mobile/app/trust/new.tsx`
- Test: `mobile/__tests__/screens/Reviews.studio.test.tsx` (new); existing Reviews/new tests stay green.

**Interfaces:**
- Consumes: `ui/*` primitives (T4), Playfair heading role (T1).

- [ ] **Step 1: Write the failing test** — render Reviews (mock its hook like the existing Reviews test); assert its screen title `fontFamily` matches `/Playfair/` and no migrated control carries `fontWeight:"700"`.

- [ ] **Step 2: Run — verify fail** — `npx jest __tests__/screens/Reviews.studio.test.tsx`.

- [ ] **Step 3: Migrate** — same recipe as T6 for `reviews.tsx` and `trust/new.tsx`: Playfair titles, `<Label>` eyebrows, `<Button>`/`<Card>` for controls/cards, retire `600`/`700` label/button weights. Preserve all behavior + accessibility labels (invite flow, create-project form validation).

- [ ] **Step 4: Run the Reviews + new suites + FULL jest + tsc** — `npx jest __tests__/screens/Reviews __tests__/screens/*new* 2>/dev/null; npx jest && npx tsc --noEmit`. Full suite must be green (last P1 task).

- [ ] **Step 5: Commit**
```bash
git add "mobile/app/(tabs)/reviews.tsx" "mobile/app/trust/new.tsx" mobile/__tests__/screens/Reviews.studio.test.tsx
git commit -m "feat(trust): Studio re-skin — Reviews + New Project on primitives + Playfair (P1)"
```

---

## Final verification (after all tasks)

- [ ] `npx jest` — full mobile suite green; `npx tsc --noEmit` clean; `npm run lint` clean.
- [ ] Device (mobile/`verify` skill): Playfair loads on native (fonts bundled, not CDN); the SME screens read in the navy Studio look; dyslexic toggle still overrides.
- [ ] Help: no new user-facing FEATURE key added (re-skin, not a new feature) — the coverage gate is unaffected. Confirm the Settings theme entry copy still matches (2 themes now).
- [ ] PR body: mobile-only; **default theme flips to studio-dark** (call out — existing users see the new look; `studio-light` available in Settings). No backend refresh.

## Self-Review

- **Spec coverage:** Playfair heading (T1) · two Studio palettes + AA gate (T2) · default + trimmed switcher (T3) · primitives (T4) · PhaseTabBar (T5) · SME screen migration (T6/T7). P2–P4 (app chrome / reader / exports) correctly deferred to later plans.
- **Type consistency:** `PLAYFAIR` map (T1) consumed by T6/T7; `studioDarkColors`/`studioLightColors` + `SWITCHABLE_THEMES` (T2/T3) consumed by T3/tests; `ui/*` primitive APIs (T4) consumed by T5–T7 verbatim.
- **Placeholders:** none — palette hex, font maps, primitive styles are literal; migration steps name the exact styles to replace.
- **Test hygiene:** no color-literal assertions (role/family/structure only); Slice B behavior tests must stay green through T6.
