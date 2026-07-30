# Responsive Left Sidebar Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On wide screens (`isDesktop` ≥1024) the horizontal top nav becomes a persistent 256px left sidebar (scene shifts right); phones/narrow keep the current top bar.

**Architecture:** Extract the shared nav data (`NAV_TABS`/`NAV_ORDER`) so both bars use one source; add a `SideNav` (vertical mirror of `TopNavBar`); `(tabs)/_layout.tsx` picks `SideNav` + `tabBarPosition:"left"` vs `TopNavBar` + `"top"` via `useResponsive()`. `tabBarPosition:"left"` is native to bottom-tabs v7.

**Tech Stack:** React Native + Expo (expo-router, @react-navigation/bottom-tabs v7), TypeScript, Jest/RNTL. Mobile only, no backend.

## Global Constraints
- **Narrow unchanged:** below 1024 the existing `TopNavBar` + `tabBarPosition:"top"` render exactly as today (no drawer this slice).
- **Pure refactor for the extraction:** moving `TABS`/`ORDER` out of `TopNavBar` must not change its behavior (its tests/rendering stay identical).
- Static `colors`/`StyleSheet` (matching `TopNavBar`; no theme migration).
- **Mobile:** `npm test`; `npx tsc --noEmit` (baseline 0); **`npx eslint <files>` before each commit** (CI lints — named components, no unused imports).
- No Help/FEATURES change (nav layout, not a user feature).

---

### Task 1: Shared `navItems` + `SideNav` component

**Files:**
- Create: `mobile/src/components/navItems.ts`
- Modify: `mobile/src/components/TopNavBar.tsx` (consume the shared data)
- Create: `mobile/src/components/SideNav.tsx`
- Test: `mobile/__tests__/components/SideNav.test.tsx`

**Interfaces:**
- `navItems.ts`: `type IconName`, `NAV_TABS`, `NAV_ORDER`.
- `SideNav({ state, navigation }: BottomTabBarProps): React.JSX.Element`.

- [ ] **Step 1: Extract `navItems.ts`**

`mobile/src/components/navItems.ts` (move `TABS`→`NAV_TABS`, `ORDER`→`NAV_ORDER`, and the `IconName` type verbatim from `TopNavBar.tsx`):
```ts
import { Ionicons } from "@expo/vector-icons";
import { NAV } from "@/constants/labels";
import { IS_DEMO } from "@/constants/demo";

export type IconName = keyof typeof Ionicons.glyphMap;

// route name → label + active/inactive icon (shared by TopNavBar + SideNav).
export const NAV_TABS: Record<string, { label: string; active: IconName; inactive: IconName }> = {
  library: { label: NAV.library, active: "library", inactive: "library-outline" },
  shelves: { label: NAV.shelves, active: "albums", inactive: "albums-outline" },
  books: { label: NAV.studio, active: "create", inactive: "create-outline" },
  projects: { label: NAV.projects, active: "folder", inactive: "folder-outline" },
  reviews: { label: NAV.reviews, active: "shield-checkmark", inactive: "shield-checkmark-outline" },
  posts: { label: NAV.posts, active: "megaphone", inactive: "megaphone-outline" },
  settings: { label: NAV.settings, active: "settings", inactive: "settings-outline" },
  help: { label: NAV.help, active: "help-circle", inactive: "help-circle-outline" },
  about: { label: NAV.about, active: "information-circle", inactive: "information-circle-outline" },
};

// Visual order. Projects/Reviews/Posts need a backend account (ADR-037) and are
// omitted from the demo build.
export const NAV_ORDER: string[] = [
  "library",
  "shelves",
  "books",
  ...(IS_DEMO ? [] : ["projects", "reviews", "posts"]),
  "settings",
  "help",
  "about",
];
```

- [ ] **Step 2: Refactor `TopNavBar` to consume it (behavior unchanged)**

In `mobile/src/components/TopNavBar.tsx`: delete the inline `type IconName`, `const TABS`, `const ORDER` (and the now-unused `NAV`/`IS_DEMO`/`Ionicons.glyphMap` type imports if they become unused — but `Ionicons` is still used for `<Ionicons>`); `import { NAV_TABS, NAV_ORDER } from "./navItems";` and replace `TABS`→`NAV_TABS`, `ORDER`→`NAV_ORDER` in the render. No other change.

- [ ] **Step 3: Verify the refactor didn't break anything**

Run: `cd mobile && npm test -- __tests__/screens/TabLayout.test.tsx && npx tsc --noEmit`
Expected: PASS + 0 type errors (pure refactor).

- [ ] **Step 4: Write the failing `SideNav` test**

`mobile/__tests__/components/SideNav.test.tsx`:
```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SideNav } from "@/components/SideNav";

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));
function makeProps(activeIndex = 0) {
  const names = ["library", "shelves", "books", "projects", "reviews", "posts", "settings", "help", "about"];
  return {
    state: { index: activeIndex, routes: names.map((name, i) => ({ key: `${name}-${i}`, name })) },
    navigation: { navigate, emit },
  } as any;
}
beforeEach(() => jest.clearAllMocks());

it("renders a row for every non-demo destination", () => {
  render(<SideNav {...makeProps()} />);
  for (const label of ["Library", "Shelves", "Studio", "Projects", "Reviews", "Posts", "Settings", "Help", "About"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
});

it("navigates on row tap", () => {
  render(<SideNav {...makeProps(0)} />);   // active = library
  fireEvent.press(screen.getByLabelText("Projects"));
  expect(navigate).toHaveBeenCalledWith("projects");
});

it("does not navigate when tapping the already-active row", () => {
  render(<SideNav {...makeProps(0)} />);   // library active
  fireEvent.press(screen.getByLabelText("Library"));
  expect(navigate).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run → FAIL** (module not found).

Run: `cd mobile && npm test -- __tests__/components/SideNav.test.tsx`

- [ ] **Step 6: Write `SideNav.tsx`**

`mobile/src/components/SideNav.tsx`:
```tsx
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { NAV_TABS, NAV_ORDER } from "./navItems";

// A persistent left sidebar version of TopNavBar for wide screens (isDesktop):
// the same destinations + navigation, laid out as a full-height 256px column so
// every tab is visible at once. Passed to <Tabs tabBar={…}> with
// tabBarPosition:"left", which shifts the scene to the right.
export function SideNav({ state, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const routeByName = new Map(state.routes.map((r) => [r.name, r] as const));
  const activeName = state.routes[state.index]?.name;

  const go = (name: string) => {
    const route = routeByName.get(name);
    if (!route) return;
    const focused = name === activeName;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      <Pressable
        onPress={() => go("library")}
        accessibilityRole="button"
        accessibilityLabel="Mentible — go to Library (home)"
        style={styles.brandRow}
      >
        <Image source={require("../../assets/brand/mentible-icon-1024-redorange.png")} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandText}>Mentible</Text>
      </Pressable>
      {NAV_ORDER.map((name) => {
        const cfg = NAV_TABS[name];
        if (!cfg || !routeByName.has(name)) return null;
        const focused = name === activeName;
        return (
          <Pressable
            key={name}
            onPress={() => go(name)}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={cfg.label}
            style={[styles.row, focused && styles.rowActive]}
          >
            <Ionicons name={focused ? cfg.active : cfg.inactive} size={22} color={focused ? colors.primaryText : colors.text} />
            <Text style={[styles.rowLabel, focused && styles.rowLabelActive]} numberOfLines={1}>{cfg.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: 256, height: "100%", backgroundColor: colors.background, borderRightColor: colors.border, borderRightWidth: 1, paddingHorizontal: spacing.sm, gap: spacing.xs },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  logo: { width: 40, height: 40 },
  brandText: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
  rowActive: { backgroundColor: colors.primary },
  rowLabel: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  rowLabelActive: { color: colors.primaryText },
});
```

- [ ] **Step 7: Run SideNav test + full detail regression + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/components/SideNav.test.tsx __tests__/screens/TabLayout.test.tsx && npx tsc --noEmit && npx eslint src/components/navItems.ts src/components/TopNavBar.tsx src/components/SideNav.tsx __tests__/components/SideNav.test.tsx`
Expected: PASS (3 SideNav tests + TabLayout unchanged) + 0 type errors + eslint clean.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/navItems.ts mobile/src/components/TopNavBar.tsx mobile/src/components/SideNav.tsx mobile/__tests__/components/SideNav.test.tsx
git commit -m "feat(nav): shared navItems + SideNav sidebar component (Lovable layer-2)"
```

---

### Task 2: Wire the responsive swap in `(tabs)/_layout.tsx`

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Test: `mobile/__tests__/screens/TabLayout.test.tsx` (extend)

**Interfaces:** consumes `useResponsive()` + `SideNav` (Task 1). Produces the width-based swap.

- [ ] **Step 1: Extend the failing test**

In `mobile/__tests__/screens/TabLayout.test.tsx`:
- Have the mocked `expo-router` `Tabs` also capture the `tabBar` prop (add `capturedTabBar = tabBar;` in the mock).
- Mock `@/components/SideNav` (like the existing `TopNavBar` mock): `jest.mock("@/components/SideNav", () => ({ SideNav: function SideNav() { return null; } }))`.
- Mock `@/hooks/useResponsive`: `jest.mock("@/hooks/useResponsive", () => ({ useResponsive: jest.fn() }))`; import it and set per-test.
- Add:
```tsx
import { useResponsive } from "@/hooks/useResponsive";
import { SideNav } from "@/components/SideNav";
import { TopNavBar } from "@/components/TopNavBar";

it("uses a left SideNav on desktop widths", () => {
  (useResponsive as jest.Mock).mockReturnValue({ width: 1300, isTablet: true, isDesktop: true });
  render(<TabLayout />);
  expect(capturedScreenOptions?.tabBarPosition).toBe("left");
  expect((capturedTabBar!({} as any) as any).type).toBe(SideNav);
});

it("uses the top TopNavBar on narrow widths", () => {
  (useResponsive as jest.Mock).mockReturnValue({ width: 500, isTablet: false, isDesktop: false });
  render(<TabLayout />);
  expect(capturedScreenOptions?.tabBarPosition).toBe("top");
  expect((capturedTabBar!({} as any) as any).type).toBe(TopNavBar);
});
```
(Keep the existing `sceneStyle` assertion test — set a `useResponsive` return in its arrange step too, or default the mock in `beforeEach`.)

- [ ] **Step 2: Run → FAIL** (still always TopNavBar / no useResponsive).

Run: `cd mobile && npm test -- __tests__/screens/TabLayout.test.tsx`

- [ ] **Step 3: Implement the swap**

`mobile/app/(tabs)/_layout.tsx`:
```tsx
import { Tabs } from "expo-router";
import { TopNavBar } from "@/components/TopNavBar";
import { SideNav } from "@/components/SideNav";
import { useResponsive } from "@/hooks/useResponsive";
import { colors } from "@/constants/theme";

export default function TabLayout() {
  const { isDesktop } = useResponsive();
  return (
    <Tabs
      tabBar={(props) => (isDesktop ? <SideNav {...props} /> : <TopNavBar {...props} />)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? "left" : "top",
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/* unchanged <Tabs.Screen> list */}
    </Tabs>
  );
}
```

- [ ] **Step 4: Run new + existing TabLayout tests + full suite + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TabLayout.test.tsx && npm test && npx tsc --noEmit && npx eslint "app/(tabs)/_layout.tsx" __tests__/screens/TabLayout.test.tsx`
Expected: all 3 TabLayout tests pass (sceneStyle + both branches); full suite green; 0 type errors; eslint clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/_layout.tsx" mobile/__tests__/screens/TabLayout.test.tsx
git commit -m "feat(nav): responsive sidebar swap on wide screens (Lovable layer-2)"
```

---

## Final verification (after all tasks)
`cd mobile && npm test && npx tsc --noEmit && npx eslint src/components/SideNav.tsx src/components/navItems.ts "app/(tabs)/_layout.tsx"`
Expected: full suite green, 0 type errors, eslint clean.

Web re-verify (the user restarts the local stack): open `localhost:8081` in a **wide** browser window (≥1024) → the nav is a left sidebar with all destinations; narrow the window below 1024 → it reverts to the top bar.

## Self-Review notes (author)
- **Spec coverage:** shared `navItems` + `SideNav` + the `TopNavBar` refactor = Task 1; the `useResponsive` swap + `tabBarPosition:"left"` = Task 2.
- **Pure refactor:** Task 1 Step 3 runs the existing TabLayout test after moving `TABS`/`ORDER` out, before adding anything new.
- **Type consistency:** `NAV_TABS`/`NAV_ORDER`/`IconName` defined in `navItems.ts` consumed by both `TopNavBar` (Task 1 Step 2) and `SideNav` (Step 6); `SideNav` signature matches the `tabBar` render-prop use in `_layout` (Task 2).
- **Test approach:** `SideNav` is unit-tested against a fabricated `BottomTabBarProps` (state/navigation stub) — same shape RN passes; the `_layout` swap is tested by capturing `screenOptions.tabBarPosition` + the `tabBar` render prop's returned element `.type` under a mocked `useResponsive`.
- **Risk:** whether a fully-custom `tabBar` at `tabBarPosition:"left"` sizes to the SideNav's own `width:256` vs a navigator default — the SideNav sets `width:256` on its root; confirm visually on the web re-verify (unit tests can't assert native layout).
