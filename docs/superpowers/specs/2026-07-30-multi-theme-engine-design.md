# Multi-Theme Engine (PR1: engine + switcher + Settings) — Design Spec

**Status:** Approved (2026-07-30) · implements **PR #340 proposal** (`docs/proposals/2026-07-27-theming-and-multi-theme-support.md`), phase **T1** (Option C — ThemeProvider + compat shim + incremental migration).
**Scope:** the theme **engine** + a Settings **Appearance** switcher + **5 selectable palettes** (incl. the two Lovable dark themes), with **only the Settings screen migrated** to be theme-reactive. Every other screen stays on the current look via a compat shim; those migrate in follow-up PRs. Mobile only.

## Why this slice
The proposal's design is settled (3-layer model; Option C recommended). The engine is the foundation every later migration depends on. Migrating **only Settings** (where the switcher lives) is the smallest slice that proves the whole mechanism end-to-end — pick a theme and Settings recolors live, including into **Gilded Noir** and **Forest & Moss** — while the compat shim keeps the ~82 un-migrated files safely on **Study** (no jarring half-migration).

## Grounding (verified)
- `mobile/src/constants/theme.ts` already exports `colors` (Study), `manuscriptColors`, `readingColors`, `themes = {study, manuscript, reading}`, `type Palette = Record<keyof typeof colors, string>`, `type ThemeName`. **Nothing consumes them.**
- **957** `colors.X` refs across **83** files; **76** build styles via module-level `StyleSheet.create` with static `colors` — so theme-reactivity requires converting each such style to a per-render themed style. This slice converts **only Settings**.
- Device-local pref precedent to mirror: `mobile/src/discovery/nudgeStore.ts` (AsyncStorage get/set, fail-safe). There is also an existing font-`mode` device-local gate in `app/_layout.tsx`.
- Root `app/_layout.tsx` wraps the app in `<AuthProvider>`; a fonts+mode gate renders a static-`colors` splash before providers mount.
- **Boundary:** book/EPUB output styling (`compiler/`, ADR-007) is a separate system — **must not move with the app theme.**

---

## New files (`mobile/src/theme/`)

### `themeStore.ts` — device-local persistence (mirror `nudgeStore.ts`)
```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeName } from "@/constants/theme";

const KEY = "theme_name";
export async function loadThemeName(): Promise<ThemeName | null>;  // null if unset/error (→ caller defaults)
export async function saveThemeName(name: ThemeName): Promise<void>; // fail-safe (never throws into UI)
```
- Validates the stored string is a known `ThemeName` (else returns null). Demo-safe: any failure → default.

### `ThemeProvider.tsx` — context + hooks
```ts
interface ThemeContextValue {
  theme: Palette;          // resolved active palette
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;  // updates state + persists (fire-and-forget)
}

export function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function useTheme(): Palette;                 // the common consumer — returns the active palette
export function useThemeControls(): { themeName: ThemeName; setTheme: (n: ThemeName) => void };
export function useThemedStyles<T>(factory: (c: Palette) => T): T; // = useMemo(() => StyleSheet.create(factory(theme)), [theme])
```
- On mount: `loadThemeName()` → set state (default `"study"` when null). Renders children immediately with the default; applies the loaded value when it resolves (no gate — a one-frame default flash is acceptable and avoids blocking paint).
- `setTheme`: `setState(name)` + `void saveThemeName(name)`.
- `useTheme()` returns `ctx.theme`. **Migrated components call `useTheme()` (or `useThemedStyles`) instead of importing the static `colors`.**

### `index.ts` — re-exports the provider + hooks.

---

## `theme.ts` additions
- Add `gildedNoirColors: Palette` and `forestMossColors: Palette` — **verbatim from the proposal §4** (charcoal+gold / greenhouse-green). Gilded Noir ships the **pure single-accent** version (accept the documented green→gold semantic collapse; the a11y test will flag its marginal muted-gold).
- Extend `themes` to 5: `{ study, manuscript, reading, "gilded-noir": gildedNoirColors, "forest-moss": forestMossColors }` (so `ThemeName` gains the two keys).
- Add `THEME_META: Record<ThemeName, { label: string; mode: "dark" | "light" | "sepia" }>` for the switcher (labels: "Study", "Manuscript", "Reading", "Gilded Noir", "Forest & Moss").
- **Compat shim:** keep the existing static `colors` export unchanged (frozen Study). Un-migrated files keep importing it. **No lint ban this slice.**

---

## Wire the provider (`app/_layout.tsx`)
- Wrap the app tree in `<ThemeProvider>` **outside** `<AuthProvider>` (theme is auth-independent). The pre-mount fonts/mode splash keeps using static `colors.background` (provider not yet mounted — acceptable, matches Study default).

## Migrate Settings (`app/(tabs)/settings.tsx`)
- Replace the module-level `const styles = StyleSheet.create({ ...colors... })` with `const styles = useThemedStyles(makeStyles)` inside the component, where `makeStyles(c: Palette) => ({ ... })` moves every `colors.X` → `c.X`.
- Any inline `colors.X` in JSX (e.g. `<ActivityIndicator color={colors.primary}>`) → `const c = useTheme(); c.primary`.
- Add an **Appearance** section (near the top or under Account):
  - Section label "APPEARANCE".
  - A horizontally-scrollable **swatch row**: one `Pressable` tile per `ThemeName`, each rendered using **that theme's** palette (tile bg = `palette.background`, a text sample = `palette.text`, an accent dot = `palette.primary`), with the `THEME_META` label beneath. Active theme shows a checkmark and a highlighted border.
  - Tap → `setTheme(name)`. Because Settings is migrated, it **recolors instantly**.
  - Accessibility label per tile: `Theme: ${label}${active ? " (selected)" : ""}`.

## Help (DoD gate)
- `mobile/src/help-content/features.ts`: add `{ key: "appearance", label: "Appearance & themes" }`.
- `mobile/src/help-content/topics.ts`: a topic `featureKey: "appearance"` explaining Settings → Appearance, that themes are colour presets applied instantly, device-local, and that book exports are unaffected.

---

## a11y contrast test (`__tests__/theme/contrast.test.ts`)
- A pure helper `contrastRatio(hex1, hex2): number` (WCAG relative-luminance formula) — small, in `src/theme/contrast.ts` (also reusable by the switcher later).
- For each palette in `themes`, assert:
  - `contrastRatio(text, background) >= 4.5` (AA body text).
  - `contrastRatio(text, surface) >= 4.5`.
  - `contrastRatio(primary, background) >= 3` (AA large/UI).
- **Gilded Noir expectation:** if its `textMuted`-on-`background` (or small gold) fails 4.5, the test documents it — either loosen the assertion to `textSecondary` (not `textMuted`) for the AA gate and record the muted-gold caveat, OR bump Noir's `textMuted` to pass. Resolve in the plan; do not silently skip a palette.

## Testing
- `__tests__/theme/themeStore.test.ts` — save→load round-trips; unknown/legacy value → null; AsyncStorage throw → null (fail-safe).
- `__tests__/theme/ThemeProvider.test.tsx` — default is `study` when unset; loads a persisted value; `setTheme` updates `useTheme()` output + calls `saveThemeName`; `useThemedStyles` recomputes when theme changes.
- `__tests__/theme/contrast.test.ts` — as above (all 5 palettes).
- `__tests__/screens/Settings.appearance.test.tsx` — renders the 5 theme tiles under a `ThemeProvider`; tapping a tile calls `setTheme`/persists and marks it selected. (Mock `themeStore`.)
- Coverage gate: the `appearance` FEATURES key + its topic land together.
- Full mobile suite + `tsc` stay green; the existing Settings tests keep passing (wrap under `ThemeProvider` if they render the screen).

## Out of scope (follow-up PRs)
- Migrating any screen other than Settings (nav, Library, Studio, reader, trust surfaces, …) — each a later PR; the shim keeps them on Study meanwhile.
- A lint rule banning the static `colors` import (added once migration completes).
- **Per-surface theming** (reader-noir / studio-bright) — provider is designed to allow it later, not built now.
- **"Follow system"** (OS light/dark reactivity).
- **Fonts** — palette colours only this slice; `fontHeading`/`fontBody` and Space Grotesk/DM Sans adoption are deferred.
- Account-synced theme pref (ADR-014).
- Restyling book/EPUB output (compiler/, ADR-007).

## Open items (resolve in the plan, non-blocking)
1. `useThemedStyles` typing — generic over the style object; ensure `tsc` is happy with `StyleSheet.create`'s named-styles inference.
2. Gilded Noir a11y: loosen the AA gate to `textSecondary` + record the muted caveat, vs nudge `textMuted` lighter. Plan picks one.
3. Swatch tile preview: a minimal 3-element tile (bg + text sample + accent dot) vs a richer mock — plan keeps it minimal.
4. Existing `Settings.test.tsx` (and any test rendering Settings) must render under `ThemeProvider` — plan wraps them / adds a test helper.
