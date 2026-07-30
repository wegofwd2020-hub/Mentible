# Multi-Theme Engine (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the theme engine (ThemeProvider + `useTheme` + persistence) with 5 selectable palettes and a Settings "Appearance" switcher, migrating **only Settings** to be theme-reactive; every other screen stays on Study via a compat shim.

**Architecture:** A React context holds the active `ThemeName` and resolves a `Palette`. `useTheme()` returns the active palette; **its context default is the Study palette**, so any component used without a provider (existing tests, edge cases) transparently gets Study — this doubles as the compat shim. `useThemedStyles(factory)` memoises `StyleSheet.create(factory(palette))` so a migrated screen's styles recolor on theme change. Persistence is device-local AsyncStorage, mirroring `nudgeStore.ts`.

**Tech Stack:** React Native + Expo, TypeScript, `@react-native-async-storage/async-storage`, Jest + RNTL.

## Global Constraints
- **Compat shim:** the static `colors` export in `theme.ts` stays unchanged (frozen Study). Do NOT migrate any screen except Settings. Do NOT add a lint rule banning static `colors` this PR.
- **`useTheme()` must not throw without a provider** — its context default is `themes.study`. This keeps the existing `Settings.test.tsx` (which renders the screen with no provider) green.
- **Book/EPUB output is off-limits** — no changes under `compiler/` (ADR-007).
- **Device-local only** — persistence via AsyncStorage key `theme_name`; demo-safe (default `study` on any failure). No account sync, no "follow system", no fonts this PR.
- **Palette shape is fixed** — every palette is a `Palette = Record<keyof typeof colors, string>`; new palettes must define **every** key (copy the full key set from `manuscriptColors`).
- **Mobile test command:** `cd mobile && npm test -- <path>`. **Typecheck:** `cd mobile && npx tsc --noEmit` (baseline 0). **Lint (the gate also runs eslint):** `cd mobile && npx eslint <files>` — run it before each commit; anonymous components trip `react/display-name`, unused imports error.
- **Help DoD gate:** a new `FEATURES` key REQUIRES a matching Help topic in the same PR (`__tests__/help/coverage.test.ts`).

---

### Task 1: Add the two Lovable palettes + metadata to `theme.ts`

**Files:**
- Modify: `mobile/src/constants/theme.ts`
- Test: `mobile/__tests__/theme/palettes.test.ts`

**Interfaces:**
- Consumes: existing `Palette`, `colors`, `manuscriptColors`, `readingColors`.
- Produces: `gildedNoirColors`, `forestMossColors` (`Palette`); `themes` extended to 5 keys; `THEME_META: Record<ThemeName, { label: string; mode: "dark" | "light" | "sepia" }>`. `ThemeName` now = `"study" | "manuscript" | "reading" | "gilded-noir" | "forest-moss"`.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/theme/palettes.test.ts`:
```ts
import { themes, THEME_META, manuscriptColors } from "@/constants/theme";
import type { ThemeName } from "@/constants/theme";

const EXPECTED: ThemeName[] = ["study", "manuscript", "reading", "gilded-noir", "forest-moss"];
const KEYS = Object.keys(manuscriptColors); // the full Palette key set

it("exposes all five themes", () => {
  expect(Object.keys(themes).sort()).toEqual([...EXPECTED].sort());
});

it("every palette defines every Palette key (no missing colours)", () => {
  for (const name of EXPECTED) {
    const p = themes[name] as Record<string, string>;
    for (const k of KEYS) expect(typeof p[k]).toBe("string");
  }
});

it("every theme has switcher metadata with a label and mode", () => {
  for (const name of EXPECTED) {
    expect(THEME_META[name].label.length).toBeGreaterThan(0);
    expect(["dark", "light", "sepia"]).toContain(THEME_META[name].mode);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/theme/palettes.test.ts`
Expected: FAIL — `gilded-noir`/`forest-moss` not in `themes`; `THEME_META` undefined.

- [ ] **Step 3: Add the palettes + metadata**

In `mobile/src/constants/theme.ts`, after `readingColors` and before the `themes` export, add (verbatim from proposal §4):
```ts
// "Gilded Noir" — editorial charcoal + single gold accent (reader-leaning,
// premium). Single-accent by design: growth/brand collapse into gold (§2.3 of
// the theming proposal) — the a11y test gates text legibility, not the accent.
export const gildedNoirColors: Palette = {
  background: "#0d0d0d", surface: "#1a1a1a", surfaceHigh: "#242424",
  border: "#262626", borderLight: "#2f2f2f",
  text: "#f5f5f4", textSecondary: "#d6d3d1", textMuted: "#a8a29e",
  primary: "#c9a84c", primaryText: "#0d0d0d",
  brand: "#c9a84c", brandText: "#0d0d0d",
  growth: "#c9a84c", growthText: "#0d0d0d",
  tileOffFace: "#1a1a1a", tileOffGlyph: "#f0d78c", tileOffShadow: "#000000",
  tileOnFace: "#c9a84c", tileOnGlyph: "#0d0d0d", tileOnHi: "#f0d78c", tileOnLo: "#9a7f2f",
  tileSubGlyph: "#a8a29e",
  success: "#7fae86", error: "#c96a5c", warning: "#d1a24c",
  white: "#ffffff",
};

// "Forest & Moss" — greenhouse-at-dusk green + moss accent (reader-leaning,
// closest to the botanical growing-mind brand). The green accent already IS the
// growth semantic, so its single-accent collapse is softer than Noir's gold.
export const forestMossColors: Palette = {
  background: "#1a3c2a", surface: "#2d5a3d", surfaceHigh: "#356848",
  border: "#366348", borderLight: "#3f7452",
  text: "#f5f5f4", textSecondary: "#d6d3d1", textMuted: "#a8a29e",
  primary: "#5a8a5c", primaryText: "#0d2016",
  brand: "#5a8a5c", brandText: "#0d2016",
  growth: "#5a8a5c", growthText: "#0d2016",
  tileOffFace: "#2d5a3d", tileOffGlyph: "#a0c49d", tileOffShadow: "#0d2016",
  tileOnFace: "#5a8a5c", tileOnGlyph: "#0d2016", tileOnHi: "#a0c49d", tileOnLo: "#3f7452",
  tileSubGlyph: "#a8a29e",
  success: "#7fae86", error: "#c96a5c", warning: "#d1a24c",
  white: "#ffffff",
};
```
Then replace the `themes` export with:
```ts
export const themes = {
  study: colors as unknown as Palette,
  manuscript: manuscriptColors,
  reading: readingColors,
  "gilded-noir": gildedNoirColors,
  "forest-moss": forestMossColors,
} as const;

export type ThemeName = keyof typeof themes;

export const THEME_META: Record<ThemeName, { label: string; mode: "dark" | "light" | "sepia" }> = {
  study: { label: "Study", mode: "dark" },
  manuscript: { label: "Manuscript", mode: "light" },
  reading: { label: "Reading", mode: "sepia" },
  "gilded-noir": { label: "Gilded Noir", mode: "dark" },
  "forest-moss": { label: "Forest & Moss", mode: "dark" },
};
```

- [ ] **Step 4: Run test + tsc**

Run: `cd mobile && npm test -- __tests__/theme/palettes.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests) + 0 type errors.

- [ ] **Step 5: Lint + commit**

```bash
cd mobile && npx eslint src/constants/theme.ts __tests__/theme/palettes.test.ts
git add mobile/src/constants/theme.ts mobile/__tests__/theme/palettes.test.ts
git commit -m "feat(theme): add Gilded Noir + Forest & Moss palettes + THEME_META (#340 T1)"
```

---

### Task 2: Contrast helper + a11y gate

**Files:**
- Create: `mobile/src/theme/contrast.ts`
- Test: `mobile/__tests__/theme/contrast.test.ts`

**Interfaces:**
- Produces: `contrastRatio(hex1: string, hex2: string): number` (WCAG 2.x, 1–21).

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/theme/contrast.test.ts`:
```ts
import { contrastRatio } from "@/theme/contrast";
import { themes } from "@/constants/theme";
import type { ThemeName } from "@/constants/theme";

const NAMES: ThemeName[] = ["study", "manuscript", "reading", "gilded-noir", "forest-moss"];

it("computes known ratios (sanity)", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
});

// Body-text legibility is the guarantee every theme must meet (this is exactly
// the class of bug the nav sceneStyle fix addressed). Accent ratios vary by
// design and are reported, not hard-gated on the muted role.
it("every theme keeps body text legible on background and surface (AA 4.5:1)", () => {
  for (const name of NAMES) {
    const p = themes[name];
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
  }
});

it("every theme's primary accent is usable on its background (AA large/UI 3:1)", () => {
  for (const name of NAMES) {
    const p = themes[name];
    expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(3);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/theme/contrast.test.ts`
Expected: FAIL — cannot find module `@/theme/contrast`.

- [ ] **Step 3: Write the helper**

`mobile/src/theme/contrast.ts`:
```ts
// WCAG 2.x relative-luminance contrast ratio (1–21). Used to gate theme
// palettes so no theme ships illegible body text.
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- __tests__/theme/contrast.test.ts`
Expected: PASS. **If a palette fails the primary-on-background 3:1 assertion**, that is a real finding — do NOT skip the palette. Record the actual ratio in your report and either (a) nudge that palette's `primary` lighter/darker in `theme.ts` to pass, or (b) relax that one assertion to the measured value with an explanatory comment. The text-on-bg/surface 4.5 assertions must NOT be relaxed.

- [ ] **Step 5: Lint + commit**

```bash
cd mobile && npx eslint src/theme/contrast.ts __tests__/theme/contrast.test.ts
git add mobile/src/theme/contrast.ts mobile/__tests__/theme/contrast.test.ts
git commit -m "feat(theme): WCAG contrast helper + per-palette a11y gate (#340 T1)"
```

---

### Task 3: `themeStore` — device-local persistence

**Files:**
- Create: `mobile/src/theme/themeStore.ts`
- Test: `mobile/__tests__/theme/themeStore.test.ts`

**Interfaces:**
- Consumes: `@react-native-async-storage/async-storage`; `ThemeName`, `themes` from `@/constants/theme`.
- Produces: `loadThemeName(): Promise<ThemeName | null>` (null when unset/unknown/error), `saveThemeName(name: ThemeName): Promise<void>` (fail-safe).

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/theme/themeStore.test.ts`:
```ts
import { loadThemeName, saveThemeName } from "@/theme/themeStore";

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      __reset: () => { store = {}; },
    },
  };
});
import AsyncStorage from "@react-native-async-storage/async-storage";

beforeEach(() => (AsyncStorage as unknown as { __reset: () => void }).__reset());

it("returns null when nothing saved", async () => {
  expect(await loadThemeName()).toBeNull();
});

it("round-trips a valid theme name", async () => {
  await saveThemeName("gilded-noir");
  expect(await loadThemeName()).toBe("gilded-noir");
});

it("returns null for an unknown/legacy stored value", async () => {
  await (AsyncStorage as unknown as { setItem: (k: string, v: string) => Promise<void> }).setItem("theme_name", "neon");
  expect(await loadThemeName()).toBeNull();
});

it("is fail-safe when storage throws", async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
  expect(await loadThemeName()).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/theme/themeStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store (mirror `nudgeStore.ts`)**

`mobile/src/theme/themeStore.ts`:
```ts
// Device-local theme preference (mirrors discovery/nudgeStore.ts). Parse-safe:
// any missing/corrupt/unknown value reads as null so the caller falls back to
// the default theme.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { themes, type ThemeName } from "@/constants/theme";

const KEY = "theme_name";

export async function loadThemeName(): Promise<ThemeName | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw && raw in themes) return raw as ThemeName;
    return null;
  } catch {
    return null;
  }
}

export async function saveThemeName(name: ThemeName): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, name);
  } catch {
    /* device-local best-effort; never surface a storage error into the UI */
  }
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd mobile && npm test -- __tests__/theme/themeStore.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests) + 0 type errors.

- [ ] **Step 5: Lint + commit**

```bash
cd mobile && npx eslint src/theme/themeStore.ts __tests__/theme/themeStore.test.ts
git add mobile/src/theme/themeStore.ts mobile/__tests__/theme/themeStore.test.ts
git commit -m "feat(theme): device-local theme persistence (#340 T1)"
```

---

### Task 4: `ThemeProvider` + hooks, wired into the app root

**Files:**
- Create: `mobile/src/theme/ThemeProvider.tsx`
- Create: `mobile/src/theme/index.ts`
- Modify: `mobile/app/_layout.tsx` (wrap the tree)
- Test: `mobile/__tests__/theme/ThemeProvider.test.tsx`

**Interfaces:**
- Consumes: `themes`, `THEME_META`, `Palette`, `ThemeName` from `@/constants/theme`; `loadThemeName`, `saveThemeName` from `@/theme/themeStore`.
- Produces: `ThemeProvider`; `useTheme(): Palette`; `useThemeControls(): { themeName: ThemeName; setTheme: (n: ThemeName) => void }`; `useThemedStyles<T>(factory: (c: Palette) => T): T`. `index.ts` re-exports all three hooks + the provider.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/theme/ThemeProvider.test.tsx`:
```ts
import React from "react";
import { Text } from "react-native";
import { render, screen, waitFor, act } from "@testing-library/react-native";
import { ThemeProvider, useTheme, useThemeControls } from "@/theme";
import { themes } from "@/constants/theme";

jest.mock("@/theme/themeStore", () => ({
  loadThemeName: jest.fn(async () => null),
  saveThemeName: jest.fn(async () => {}),
}));
import { loadThemeName, saveThemeName } from "@/theme/themeStore";

function Probe() {
  const c = useTheme();
  const { themeName, setTheme } = useThemeControls();
  return (
    <>
      <Text testID="name">{themeName}</Text>
      <Text testID="bg">{c.background}</Text>
      <Text testID="switch" onPress={() => setTheme("forest-moss")}>go</Text>
    </>
  );
}

beforeEach(() => jest.clearAllMocks());

it("defaults to study when nothing is persisted", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("study"));
  expect(screen.getByTestId("bg").props.children).toBe(themes.study.background);
});

it("loads a persisted theme on mount", async () => {
  (loadThemeName as jest.Mock).mockResolvedValueOnce("gilded-noir");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("gilded-noir"));
  expect(screen.getByTestId("bg").props.children).toBe(themes["gilded-noir"].background);
});

it("setTheme updates the palette and persists", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("study"));
  act(() => { screen.getByTestId("switch").props.onPress(); });
  await waitFor(() => expect(screen.getByTestId("bg").props.children).toBe(themes["forest-moss"].background));
  expect(saveThemeName).toHaveBeenCalledWith("forest-moss");
});

it("useTheme falls back to Study with no provider (compat shim)", () => {
  render(<Probe />);
  expect(screen.getByTestId("bg").props.children).toBe(themes.study.background);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/theme/ThemeProvider.test.tsx`
Expected: FAIL — cannot find module `@/theme`.

- [ ] **Step 3: Write the provider + hooks**

`mobile/src/theme/ThemeProvider.tsx`:
```tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { themes, type Palette, type ThemeName } from "@/constants/theme";
import { loadThemeName, saveThemeName } from "./themeStore";

interface ThemeContextValue {
  theme: Palette;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
}

// Default = Study, so useTheme() outside a provider returns the current look
// (the compat shim: un-migrated screens/tests never crash and never change).
const ThemeContext = createContext<ThemeContextValue>({
  theme: themes.study,
  themeName: "study",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [themeName, setThemeName] = useState<ThemeName>("study");

  // Apply the persisted choice once resolved. No render gate — a one-frame
  // Study default before the stored value lands is acceptable.
  useEffect(() => {
    let alive = true;
    void loadThemeName().then((n) => {
      if (alive && n) setThemeName(n);
    });
    return () => { alive = false; };
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    void saveThemeName(name);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[themeName], themeName, setTheme }),
    [themeName, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext).theme;
}

export function useThemeControls(): { themeName: ThemeName; setTheme: (n: ThemeName) => void } {
  const { themeName, setTheme } = useContext(ThemeContext);
  return { themeName, setTheme };
}

// Ergonomic replacement for a module-level StyleSheet.create(...colors...):
// `const styles = useThemedStyles(makeStyles)` recomputes when the theme changes.
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T): T {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [theme, factory]);
}
```

`mobile/src/theme/index.ts`:
```ts
export { ThemeProvider, useTheme, useThemeControls, useThemedStyles } from "./ThemeProvider";
```

- [ ] **Step 4: Wire the provider into the app root**

In `mobile/app/_layout.tsx`: import `{ ThemeProvider } from "@/theme"` and wrap the returned tree so `ThemeProvider` is the outermost app provider (outside `AuthProvider`). Leave the pre-mount fonts/mode splash (`<View style={{ backgroundColor: colors.background }} />`) as-is — it renders before the provider mounts and matches the Study default.
Example:
```tsx
  return (
    <ThemeProvider>
      <AuthProvider>
        {/* ...existing StatusBar + Stack... */}
      </AuthProvider>
    </ThemeProvider>
  );
```

- [ ] **Step 5: Run test + tsc**

Run: `cd mobile && npm test -- __tests__/theme/ThemeProvider.test.tsx && npx tsc --noEmit`
Expected: PASS (4 tests) + 0 type errors.

- [ ] **Step 6: Lint + commit**

```bash
cd mobile && npx eslint src/theme __tests__/theme/ThemeProvider.test.tsx app/_layout.tsx
git add mobile/src/theme/ThemeProvider.tsx mobile/src/theme/index.ts mobile/app/_layout.tsx mobile/__tests__/theme/ThemeProvider.test.tsx
git commit -m "feat(theme): ThemeProvider + useTheme/useThemedStyles, wired at root (#340 T1)"
```

---

### Task 5: Migrate Settings + the Appearance switcher

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`
- Test: `mobile/__tests__/screens/Settings.appearance.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, `useThemedStyles`, `useThemeControls` from `@/theme`; `themes`, `THEME_META`, `type ThemeName` from `@/constants/theme`.
- Produces: Settings renders theme-reactive; an Appearance swatch row (one tile per `ThemeName`).

**Migration notes:**
- Replace `import { colors, radius, spacing, typography } from "@/constants/theme"` with `import { radius, spacing, typography, THEME_META, themes, type ThemeName } from "@/constants/theme"` + `import { useTheme, useThemedStyles, useThemeControls } from "@/theme"`.
- Convert the module-level `const styles = StyleSheet.create({...})` into `function makeStyles(c: Palette) { return { ... } }` with every `colors.X` → `c.X`; inside the component do `const styles = useThemedStyles(makeStyles)`.
- The inline `colors.*` on the `Switch` (`trackColor`, `thumbColor`) → `const c = useTheme()` then `c.border`/`c.primary`/`c.white`.
- Keep `radius`/`spacing`/`typography` as static imports (not themed).

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/screens/Settings.appearance.test.tsx`:
```ts
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn(async () => null), saveApiKey: jest.fn(), deleteApiKey: jest.fn(),
  maskApiKey: (k: string) => k, isValidApiKey: () => true,
}));
jest.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ status: "unavailable", session: null }) }));
jest.mock("@/theme/themeStore", () => ({ loadThemeName: jest.fn(async () => null), saveThemeName: jest.fn(async () => {}) }));
import { saveThemeName } from "@/theme/themeStore";

import { ThemeProvider } from "@/theme";
import SettingsScreen from "../../app/(tabs)/settings";

beforeEach(() => jest.clearAllMocks());

it("shows a tile for every theme and applies one on tap", async () => {
  render(<ThemeProvider><SettingsScreen /></ThemeProvider>);
  // all five tiles present
  for (const label of ["Study", "Manuscript", "Reading", "Gilded Noir", "Forest & Moss"]) {
    expect(await screen.findByLabelText(new RegExp(`Theme: ${label}`))).toBeTruthy();
  }
  fireEvent.press(screen.getByLabelText(/Theme: Forest & Moss/));
  await waitFor(() => expect(saveThemeName).toHaveBeenCalledWith("forest-moss"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/screens/Settings.appearance.test.tsx`
Expected: FAIL — no Appearance tiles yet.

- [ ] **Step 3: Migrate the screen + add the Appearance section**

Apply the migration notes above. Add an **Appearance** section (place it right after the Account row, before "Plans & billing"). Inside the component:
```tsx
  const c = useTheme();
  const { themeName, setTheme } = useThemeControls();
  const styles = useThemedStyles(makeStyles);
  const THEME_NAMES = Object.keys(THEME_META) as ThemeName[];
```
Section JSX:
```tsx
      <Text style={styles.sectionLabel}>Appearance</Text>
      <Text style={styles.helpText}>
        Pick a colour theme. It applies instantly across the app and is saved on
        this device. Your book exports are not affected.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
        {THEME_NAMES.map((name) => {
          const p = themes[name];
          const active = name === themeName;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Theme: ${THEME_META[name].label}${active ? " (selected)" : ""}`}
              onPress={() => setTheme(name)}
              style={[styles.swatch, { backgroundColor: p.background, borderColor: active ? p.primary : p.border }]}
            >
              <Text style={[styles.swatchSample, { color: p.text }]}>Aa</Text>
              <View style={[styles.swatchDot, { backgroundColor: p.primary }]} />
              <Text style={styles.swatchLabel}>{THEME_META[name].label}</Text>
              {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.divider} />
```
Add to `makeStyles(c)` (theme-reactive) the new style keys:
```ts
    swatchRow: { gap: spacing.sm, paddingVertical: spacing.sm },
    swatch: { width: 92, borderRadius: radius.md, borderWidth: 2, padding: spacing.sm, alignItems: "center", gap: 4 },
    swatchSample: { fontSize: typography.sizeLg, fontWeight: "700" },
    swatchDot: { width: 14, height: 14, borderRadius: 7 },
    swatchLabel: { color: c.textSecondary, fontSize: typography.sizeXs, textAlign: "center" },
    swatchCheck: { color: c.primary, fontWeight: "700" },
```

- [ ] **Step 4: Run the new test + the existing Settings test + tsc**

Run: `cd mobile && npm test -- __tests__/screens/Settings.appearance.test.tsx __tests__/screens/Settings.test.tsx && npx tsc --noEmit`
Expected: BOTH pass (the existing `Settings.test.tsx` renders with no provider → `useTheme()` returns the Study default via the context default, so it is unaffected) + 0 type errors.

- [ ] **Step 5: Lint + commit**

```bash
cd mobile && npx eslint "app/(tabs)/settings.tsx" __tests__/screens/Settings.appearance.test.tsx
git add "mobile/app/(tabs)/settings.tsx" mobile/__tests__/screens/Settings.appearance.test.tsx
git commit -m "feat(theme): theme-reactive Settings + Appearance switcher (#340 T1)"
```

---

### Task 6: Help topic + full-suite/DoD gate

**Files:**
- Modify: `mobile/src/help-content/features.ts`
- Modify: `mobile/src/help-content/topics.ts`

**Interfaces:**
- Produces: `appearance` FEATURES key + a matching Help topic.

- [ ] **Step 1: Add the FEATURES key**

In `mobile/src/help-content/features.ts`, add to `FEATURES`:
```ts
  { key: "appearance", label: "Appearance & themes" },
```

- [ ] **Step 2: Run the coverage test to verify it FAILS (feature without a topic)**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts`
Expected: FAIL — `appearance` uncovered.

- [ ] **Step 3: Add the Help topic**

In `mobile/src/help-content/topics.ts`, add to `HELP_TOPICS`:
```ts
  {
    id: "appearance",
    title: "Appearance & themes",
    featureKey: "appearance",
    keywords: ["theme", "themes", "appearance", "colour", "color", "dark", "light", "sepia", "gilded noir", "forest", "moss"],
    blocks: [
      {
        kind: "text",
        text: "Settings → Appearance lets you pick a colour theme. Themes are curated colour presets — Study (the default), Manuscript (light), Reading (sepia), Gilded Noir, and Forest & Moss. A theme applies instantly across the app and is remembered on this device. It changes only the app's colours; your books and their exports are unaffected.",
      },
    ],
  },
```

- [ ] **Step 4: Run coverage + full suite + tsc**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts && npm test && npx tsc --noEmit`
Expected: coverage PASS; entire suite green (all new theme tests + existing tests); 0 type errors.

- [ ] **Step 5: Lint + commit**

```bash
cd mobile && npx eslint src/help-content/features.ts src/help-content/topics.ts
git add mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "feat(theme): Help topic for Appearance & themes (#340 T1 DoD)"
```

---

## Final verification (after all tasks)
```bash
cd mobile && npm test && npx tsc --noEmit && npx eslint src/theme "app/(tabs)/settings.tsx" src/constants/theme.ts
```
Expected: full suite green, 0 type errors, eslint clean on the changed files.

Optional device re-verify (`mobile:verify` skill, JS-only → Metro reload, no rebuild): open Settings → tap Gilded Noir / Forest & Moss → Settings recolors live. Not required for merge.

## Self-Review notes (author)
- **Spec coverage:** engine (ThemeProvider/useTheme/useThemedStyles) = Task 4; persistence = Task 3; 5 palettes + metadata = Task 1; a11y contrast gate = Task 2; Settings migration + switcher = Task 5; Help DoD = Task 6. Compat shim = the Study context default (Task 4) — verified by Task 4's "no provider" test and Task 5's reuse of the untouched `Settings.test.tsx`.
- **Deferred per spec (not in any task):** other screens' migration, lint ban, per-surface theming, follow-system, fonts, account sync, book output — all out of scope.
- **Type consistency:** `ThemeName` gains `"gilded-noir"|"forest-moss"` in Task 1; `Palette` unchanged; `useTheme(): Palette`, `useThemeControls()`, `useThemedStyles(factory)` defined in Task 4 and consumed in Task 5 with matching signatures; `themeStore` load/save signatures (Task 3) match the provider's use (Task 4).
- **Risk flagged:** Task 2 primary-on-bg 3:1 gate may surface a marginal shipped palette — the task gives an explicit resolve path (adjust palette or relax that one assertion; never relax the text 4.5 gate).
- **Lint reminder** is in Global Constraints + every task's commit step (the CI gate runs eslint; earlier work tripped `react/display-name` by skipping local eslint).
