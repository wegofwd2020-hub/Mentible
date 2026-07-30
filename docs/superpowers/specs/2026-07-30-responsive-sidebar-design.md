# Responsive Left Sidebar Nav — Design Spec

**Status:** Approved (2026-07-30) · implements the Lovable "Persistent Sidebar" (layer-2 IA, deferred from the theming proposal #340) as a **responsive** nav.
**Scope:** on wide screens (`isDesktop`, ≥1024) the horizontal top nav becomes a **persistent left sidebar** (scene shifts right); phones and narrow browsers keep the current top bar. Mobile only (RN + Expo web), no backend.

## Why
The app's nav is a horizontal `TopNavBar` whose tiles **scroll off-screen** on narrow widths (Posts/Reviews get cut off — seen in device-verify). On a wide screen there's room to show **all destinations at once** in a left column — the Lovable direction the user provided, and a wayfinding win (everything visible). Keyed on **width** (not `Platform.OS`) so a wide desktop-web window and a large/landscape tablet both get the sidebar, while a narrow browser or phone keeps the compact top bar.

## Grounding (verified)
- `app/(tabs)/_layout.tsx`: `<Tabs tabBar={(props) => <TopNavBar {...props} />} screenOptions={{ headerShown:false, tabBarPosition:"top", sceneStyle:{backgroundColor:colors.background} }}>`.
- **`@react-navigation/bottom-tabs@7.18.7` supports `tabBarPosition: 'bottom' | 'left' | 'right' | 'top'`** — so `"left"` reserves a left column and shifts the scene right, natively.
- `TopNavBar({ state, navigation }: BottomTabBarProps)`: a `TABS` map (route → label + active/inactive icon), an `ORDER` array with `...(IS_DEMO ? [] : ["projects","reviews","posts"])`, a leading brand logo → Library, and `go(name)` = `navigation.emit("tabPress")` then `navigation.navigate`.
- `useResponsive()` → `{ width, isTablet (≥768), isDesktop (≥1024) }` (already used app-wide).
- `TabLayout.test.tsx` mocks `expo-router` `Tabs` to capture `screenOptions` + mocks `TopNavBar` — extend it for the swap.

---

## New: `src/components/navItems.ts` (shared nav data)
Extract the static nav vocabulary so both bars use ONE source (no drift):
```ts
export const NAV_TABS: Record<string, { label: string; active: IconName; inactive: IconName }> = { /* moved verbatim from TopNavBar.TABS */ };
export const NAV_ORDER: string[] = ["library","shelves","books", ...(IS_DEMO ? [] : ["projects","reviews","posts"]), "settings","help","about"]; // moved verbatim
```
`TopNavBar` imports `NAV_TABS`/`NAV_ORDER` (its inline copies removed) — **pure refactor, behavior unchanged** (TabLayout test + any nav rendering stays identical).

## New: `src/components/SideNav.tsx`
A vertical version of `TopNavBar`, same props + navigation logic:
```ts
export function SideNav({ state, navigation }: BottomTabBarProps): React.JSX.Element;
```
- Reuses `NAV_TABS`/`NAV_ORDER` + the same `go(name)` (emit tabPress → navigate) + `activeName = state.routes[state.index]?.name`.
- Layout: a full-height **~256px** left column with a top+bottom `SafeArea` inset; brand mark at the top (→ Library); then `NAV_ORDER.map` as **rows** (icon + label side by side, left-aligned); the active row gets the highlighted treatment (accent background/text, mirroring the tile active state). A right border (`colors.border`) separates it from the scene. Static `colors`/`StyleSheet` (matching TopNavBar; no theme migration).
- Accessibility: each row `accessibilityRole="tab"`, `accessibilityState={{ selected }}`, `accessibilityLabel={label}` (same as TopNavBar tiles) — so existing/label-based selectors keep working.

## Wire the swap: `app/(tabs)/_layout.tsx`
```tsx
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
```
Switching `tabBarPosition` + the `tabBar` component on a width change re-renders `TabLayout` (via `useResponsive`) and the navigator re-lays out.

## Testing
- **`__tests__/components/SideNav.test.tsx`** (RNTL): renders the non-demo `NAV_ORDER` rows (Library/Shelves/Studio/Projects/Reviews/Posts/Settings/Help/About by label); tapping a row calls `navigation.navigate` with that route (mock `navigation`/`state` like a `BottomTabBarProps` stub); the active route's row shows the selected state. (Mirror how a tabBar is unit-tested against a fabricated `state`/`navigation`.)
- **`__tests__/screens/TabLayout.test.tsx`** (extend): mock `@/hooks/useResponsive`. When `isDesktop` → captured `screenOptions.tabBarPosition === "left"` and the `tabBar` render prop returns `<SideNav>`; when not → `"top"` + `<TopNavBar>`. (The test already captures `screenOptions` + the `tabBar` prop via the mocked `Tabs`; add a `useResponsive` mock + assert both branches. Mock `@/components/SideNav` alongside the existing `TopNavBar` mock.)
- Full suite + `tsc` + `eslint` green. No Help/FEATURES change (nav layout, not a feature).

## Out of scope (later)
- A mobile **drawer/hamburger** (narrow keeps the existing top bar this slice).
- Collapsing/pinning the sidebar (fixed 256px when shown).
- Sidebar footer "Pro" card / search (Lovable extras).
- Theming the sidebar (static colors; theme migration is the #340 follow-up).
- Changing the scene's own max-width behaviour (PageContainer already caps content).

## Open items (resolve in the plan, non-blocking)
1. Exact sidebar width (256 vs 240) + row paddings — plan picks 256 (Lovable spec).
2. Whether a fully-custom `tabBar` at `tabBarPosition:"left"` sizes to the component's own width (256) or a navigator default — verify on web/device; the SideNav sets `width: 256` on its root regardless.
3. The brand logo asset reuse from TopNavBar (same `require(...)`).
