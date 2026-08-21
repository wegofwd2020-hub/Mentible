# Landing Home + Unified Nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/`→Library redirect with a real Landing Home built from the captured layout + honest copy, make the web nav auth-state-aware, and default the app to the navy+gold `navy-trust` theme.

**Architecture:** A new `components/landing/*` section family (built from existing `Card`/`Label`/`Chip`/`AccentText` + theme tokens) composed by `LandingHome`, rendered from `(tabs)/index.tsx`. `TopNavBar`/`SideNav` branch on `useAuth().status` to show marketing links + Sign-in (signed-out) or app tabs + an `AccountMenu` (signed-in). `ThemeProvider` defaults to `navy-trust`, which also joins the theme switcher.

**Tech Stack:** React Native + Expo Router, TypeScript, Jest + React Native Testing Library. No backend, no new deps.

**Spec:** `docs/superpowers/specs/2026-08-21-landing-home-unified-nav-design.md`

## Global Constraints

- **No hardcoded colors/fonts** in landing/nav code — use `useThemedStyles(makeStyles)` + theme `Palette` tokens (`background`, `surface`, `border`, `text`, `textMuted`, `primary`, `primaryText`) and `FRAUNCES`/`INTER`/`AccentText`. The one exception: `ApprovalCardExample` pins its own navy/gold (it mimics the product's real card).
- **Honest copy only** — approval card labeled "Example"; Formats lists only built exports; no "review time", no four-axis scorecard, no YouTube/newsletter/learning-module, no case studies, no "interview/recorded/transcribed" capture claim. Say "signed-off / recorded", never blanket "expert-approved".
- **Default theme = `navy-trust`**; a user's persisted choice still wins. Add `navy-trust` to `SWITCHABLE_THEMES`; do not alter any palette's color values.
- **Everyone sees Home**, all auth states (`loading|signed_in|signed_out|unavailable`). Anchor-scroll is `Platform.OS === "web"` only.
- **Run the FULL `npx jest`** before declaring done (past lesson: targeted runs miss app-shell guard tests).
- **DoD:** a user-facing feature is not done until its Help topic + `FEATURES` entry land in the same PR (coverage gate `__tests__/help/coverage.test.ts`).

---

### Task 1: Default theme → `navy-trust` + switchable

**Files:**
- Modify: `mobile/src/theme/ThemeProvider.tsx` (default context value + `useState` initial, ~lines 18-24)
- Modify: `mobile/src/constants/theme.ts` (`SWITCHABLE_THEMES`, ~line 378)
- Test: `mobile/src/theme/__tests__/ThemeProvider.default.test.tsx` (create)

**Interfaces:**
- Consumes: `themes` map + `ThemeName` (both from `@/constants/theme`); `navy-trust` is a valid `ThemeName` (`THEME_META["navy-trust"]`, `themes["navy-trust"]` already exist).
- Produces: default `themeName === "navy-trust"`; `SWITCHABLE_THEMES` includes `"navy-trust"`.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/theme/__tests__/ThemeProvider.default.test.tsx
import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { ThemeProvider, useThemeName } from "@/theme/ThemeProvider";
import { SWITCHABLE_THEMES } from "@/constants/theme";

function Probe() { return <Text testID="name">{useThemeName()}</Text>; }

test("app defaults to navy-trust for a new/unset user", () => {
  const { getByTestId } = render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(getByTestId("name").props.children).toBe("navy-trust");
});

test("navy-trust is offered in the theme switcher", () => {
  expect(SWITCHABLE_THEMES).toContain("navy-trust");
});
```

If `useThemeName` doesn't exist, read `ThemeProvider.tsx` for the actual hook that returns the current `themeName` (e.g. `useTheme().name` or a context field) and adjust the probe to read that — do not add a new hook just for the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/theme/__tests__/ThemeProvider.default.test.tsx`
Expected: FAIL — default is `"studio-light"`, and `SWITCHABLE_THEMES` lacks `navy-trust`.

- [ ] **Step 3: Implement**

In `ThemeProvider.tsx` replace the two `"studio-light"` defaults (the context default object's `theme`/`themeName`, ~lines 18-19, and the `useState<ThemeName>("studio-light")`, ~line 24) with `"navy-trust"`:

```tsx
// context default (~18-19)
theme: themes["navy-trust"],
themeName: "navy-trust",
// initial state (~24)
const [themeName, setThemeName] = useState<ThemeName>("navy-trust");
```

In `constants/theme.ts` add `navy-trust` to the switcher (keep it first so it reads as the primary identity):

```ts
export const SWITCHABLE_THEMES: ThemeName[] = ["navy-trust", "studio-dark", "studio-light", "studio-green", "studio-crimson"];
```

Do not touch the persistence-load path — a stored choice must still override the new default (it already does; only the *unset* default changes).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/theme/__tests__/ThemeProvider.default.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/theme/ThemeProvider.tsx mobile/src/constants/theme.ts mobile/src/theme/__tests__/ThemeProvider.default.test.tsx
git commit -m "feat(theme): default to navy-trust (navy+gold) + add to switcher"
```

---

### Task 2: Nav data — Home tab + marketing links

**Files:**
- Modify: `mobile/src/constants/labels.ts` (`NAV` object)
- Modify: `mobile/src/components/navItems.ts` (`NAV_TABS`, `NAV_ORDER`, new `MARKETING_LINKS`)
- Test: `mobile/src/components/__tests__/navItems.test.ts` (create)

**Interfaces:**
- Consumes: `NAV` from `@/constants/labels`, `IconName` + `IS_DEMO` (already in `navItems.ts`).
- Produces:
  - `NAV.home = "Home"`, `NAV.howItWorks = "How it works"`, `NAV.formats = "Formats"`, `NAV.trust = "Trust"`, `NAV.pricing = "Pricing"`.
  - `NAV_TABS.home = { label: NAV.home, active: "home", inactive: "home-outline" }`.
  - `NAV_ORDER` begins with `"home"`.
  - `export const MARKETING_LINKS: { label: string; anchor: string }[]` = How it works→`how-it-works`, Formats→`formats`, Trust→`trust`, Pricing→`pricing`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/src/components/__tests__/navItems.test.ts
import { NAV_TABS, NAV_ORDER, MARKETING_LINKS } from "@/components/navItems";

test("Home is a nav tab and leads the order", () => {
  expect(NAV_TABS.home).toEqual({ label: "Home", active: "home", inactive: "home-outline" });
  expect(NAV_ORDER[0]).toBe("home");
});

test("marketing links map labels to Home-section anchors", () => {
  expect(MARKETING_LINKS.map((l) => l.anchor)).toEqual(["how-it-works", "formats", "trust", "pricing"]);
  expect(MARKETING_LINKS[0].label).toBe("How it works");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/components/__tests__/navItems.test.ts`
Expected: FAIL — `NAV_TABS.home`/`MARKETING_LINKS` undefined.

- [ ] **Step 3: Implement**

In `labels.ts` add to the `NAV` object:

```ts
  home: "Home",
  howItWorks: "How it works",
  formats: "Formats",
  trust: "Trust",
  pricing: "Pricing",
```

In `navItems.ts`:

```ts
// add to NAV_TABS
  home: { label: NAV.home, active: "home", inactive: "home-outline" },
// NAV_ORDER — Home leads, everything else unchanged
export const NAV_ORDER: string[] = [
  "home",
  "library",
  ...(IS_DEMO ? [] : ["books", "projects", "reviews", "posts"]),
  "settings",
  "help",
  "about",
];
// marketing links (signed-out top bar) → Home section anchors
export const MARKETING_LINKS: { label: string; anchor: string }[] = [
  { label: NAV.howItWorks, anchor: "how-it-works" },
  { label: NAV.formats, anchor: "formats" },
  { label: NAV.trust, anchor: "trust" },
  { label: NAV.pricing, anchor: "pricing" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/components/__tests__/navItems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/constants/labels.ts mobile/src/components/navItems.ts mobile/src/components/__tests__/navItems.test.ts
git commit -m "feat(nav): add Home tab + marketing-link anchors data"
```

---

### Task 3: Landing sections + `LandingHome`

**Files:**
- Create: `mobile/src/components/landing/Hero.tsx`, `ApprovalCardExample.tsx`, `Phases.tsx`, `Formats.tsx`, `PilotCTA.tsx`, `LandingHome.tsx`, `anchor.ts`
- Test: `mobile/src/components/landing/__tests__/LandingHome.test.tsx` (create)

**Interfaces:**
- Consumes: `Card` (`{children, style}`), `Label` (`{children, tone?: "muted"|"secondary", style?}`), `Chip` (`{label, active?, style?}`) from `@/components/ui/*`; `AccentText` (`{children}`) from `@/components/AccentText`; `useThemedStyles`, `useTheme` from `@/theme`; `FRAUNCES` from `@/constants/fonts`; `useRouter` from `expo-router`.
- Produces: `export function LandingHome(): JSX.Element` (a `ScrollView` of the sections); `export function sectionAnchor(id: string)` returning web anchor props.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/components/landing/__tests__/LandingHome.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
const push = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
import { LandingHome } from "@/components/landing/LandingHome";

beforeEach(() => push.mockClear());

test("hero shows headline, accent word, and honest subhead", () => {
  const { getByText, queryByText } = render(<LandingHome />);
  expect(getByText(/Turn expertise into/i)).toBeTruthy();
  expect(getByText(/trusted knowledge/i)).toBeTruthy();
  expect(getByText(/cited back to/i)).toBeTruthy();
  // honesty guardrails: no fabricated proof strings
  expect(queryByText(/review time/i)).toBeNull();
  expect(queryByText(/YouTube/i)).toBeNull();
});

test("approval card is labeled an Example and shows provenance", () => {
  const { getByText } = render(<LandingHome />);
  expect(getByText(/Example/i)).toBeTruthy();
  expect(getByText(/never hide who signed off/i)).toBeTruthy();
});

test("Formats lists only built exports", () => {
  const { getByText, queryByText } = render(<LandingHome />);
  ["EPUB", "PDF", "Carousel", "Audio"].forEach((f) => expect(getByText(new RegExp(f, "i"))).toBeTruthy());
  expect(queryByText(/Newsletter/i)).toBeNull();
});

test("primary CTA routes to work-with-me", () => {
  const { getByText } = render(<LandingHome />);
  fireEvent.press(getByText(/Book a 30-minute conversation/i));
  expect(push).toHaveBeenCalledWith("/work-with-me");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/components/landing/__tests__/LandingHome.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`anchor.ts` — web-only anchor id (native ignores it):

```tsx
import { Platform } from "react-native";
// On web, expose an id so top-bar links can scrollIntoView; native no-op.
export const sectionAnchor = (id: string) =>
  Platform.OS === "web" ? ({ nativeID: id } as const) : ({} as const);
```

`Hero.tsx` — headline + accent word + honest subhead + two CTAs + stat strip. Use theme tokens via `useThemedStyles`; heading family `FRAUNCES.regular`; `<AccentText>trusted knowledge.</AccentText>` inline in the `<Text>`:

```tsx
import { View, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { AccentText } from "@/components/AccentText";
import { useThemedStyles } from "@/theme";
import { FRAUNCES } from "@/constants/fonts";
import { sectionAnchor } from "./anchor";

export function Hero() {
  const s = useThemedStyles(make);
  const router = useRouter();
  return (
    <View style={s.hero}>
      <Text style={s.h1}>Turn expertise into <AccentText>trusted knowledge.</AccentText></Text>
      <Text style={s.sub}>Expert-validated books, guides, and social content — drafted by AI from your own sources, every claim cited back to one, then reviewed and signed off by a named expert.</Text>
      <View style={s.ctas}>
        <Pressable accessibilityRole="button" style={s.ctaPrimary} onPress={() => router.push("/work-with-me")}>
          <Text style={s.ctaPrimaryText}>Book a 30-minute conversation</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={s.ctaGhost} onPress={() => router.push("/work-with-me")}>
          <Text style={s.ctaGhostText}>See how it works</Text>
        </Pressable>
      </View>
      <View style={s.stats}>
        {[["Weeks, not months","one focused sprint"],["1 source","book + derivatives"],["Named-expert sign-off","recorded on each version"]].map(([n,l]) => (
          <View key={l} style={s.stat}><Text style={s.statN}>{n}</Text><Text style={s.statL}>{l}</Text></View>
        ))}
      </View>
    </View>
  );
}
const make = (t: any) => ({ /* theme-token styles: h1 FRAUNCES.regular ~40-56, colors t.text/t.textMuted/t.primary/t.primaryText/t.surface; ctaPrimary bg t.primary text t.primaryText; ctaGhost border t.border */ } as const);
```

(The implementer fills `make(t)` from theme tokens per the Global Constraints — heading `fontFamily: FRAUNCES.regular`, letter-spacing `-0.02em` on web via a `Platform.select`, colors from `t`.)

`ApprovalCardExample.tsx` (anchor `trust`) — a `View` with `{...sectionAnchor("trust")}`, a `<Label>Example</Label>` badge, and the honest rows. **Pins its own navy/gold** (constants, not theme): background `#0e1421`, ink `#f4f2ea`, gold `#d6a94b`, muted `#93a0b4`.

```
APPROVAL RECORD · ● Expert-validated
Stormwater practice guide — Ch. 3, §2
Revision 4 · approved by Dr. R. Patel (named expert) · recorded 12 Aug 2026
PROVENANCE  Recorded by the expert — not operator-on-behalf   expert_self
GROUNDING   Every claim traced to a cited source              checked
COVERAGE    Sections backed by a live source                  100%
READABILITY Reading level                                      accessible
"A version reads expert-validated only when the named expert records it. If the
operator records it for them, it says operator-recorded. We never hide who signed off."
```

`Phases.tsx` (anchor `how-it-works`) — four `Card`s:
```
01 Capture   — Paste transcripts, notes, and links; we organize them into labelled sources.
02 Create    — AI drafts an outline and cornerstone asset from those sources only — every section attributed to its source, inventing nothing. A grounding check flags any unbacked claim.
03 Validate  — The named expert reviews each version, leaves feedback, and approves or withdraws it. Approval is stamped with who recorded it; coverage and readability score automatically.
04 Share     — Publish the approved master as an EPUB, PDF, or KDP-ready pack, plus social derivatives.
```

`Formats.tsx` (anchor `formats`) — a wrapped row of `Chip`s, built exports only:
`Book · EPUB · PDF · DOCX · KDP pack · LinkedIn post · Carousel · X thread · Image card · Animated card · Audio`.

`PilotCTA.tsx` (anchor `pricing`) — a `Card` band: heading "Publish your first asset in a focused sprint.", body "A short book or guide plus reusable derivatives, an expert-approval record, and source traceability.", a Pressable "Become a design partner" → `router.push("/work-with-me")`.

`LandingHome.tsx` — composes them in a `ScrollView`:

```tsx
import { ScrollView } from "react-native";
import { Hero } from "./Hero";
import { ApprovalCardExample } from "./ApprovalCardExample";
import { Phases } from "./Phases";
import { Formats } from "./Formats";
import { PilotCTA } from "./PilotCTA";
import { useThemedStyles } from "@/theme";

export function LandingHome() {
  const s = useThemedStyles(make);
  return (
    <ScrollView style={s.page} contentContainerStyle={s.inner}>
      <Hero />
      <ApprovalCardExample />
      <Phases />
      <Formats />
      <PilotCTA />
    </ScrollView>
  );
}
const make = (t: any) => ({ page: { flex: 1, backgroundColor: t.background }, inner: { paddingBottom: 48, gap: 40 } } as const);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/components/landing/__tests__/LandingHome.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/landing
git commit -m "feat(landing): honest Landing Home sections (hero, approval example, phases, formats, pilot)"
```

---

### Task 4: Wire `/` → `LandingHome`

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx` (replace the `<Redirect />`)
- Modify: `mobile/app/(tabs)/_layout.tsx` (ensure `index` is a registered `Tabs.Screen` — it already is, ~line 36; no visual-order change needed here since `NAV_ORDER` drives order)
- Test: `mobile/app/(tabs)/__tests__/index.test.tsx` (create)

**Interfaces:**
- Consumes: `LandingHome` from `@/components/landing/LandingHome`.
- Produces: `(tabs)/index.tsx` default export renders `<LandingHome />`.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/app/(tabs)/__tests__/index.test.tsx
import { render } from "@testing-library/react-native";
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
import Index from "@/../app/(tabs)/index";

test("/ renders the Landing Home, not a redirect", () => {
  const { getByText } = render(<Index />);
  expect(getByText(/Turn expertise into/i)).toBeTruthy();
});
```

If the `@/../app` import path doesn't resolve in jest, import via the configured route alias used by other `app/**/__tests__` files (check a sibling test for the exact form) rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest "app/(tabs)/__tests__/index.test.tsx"`
Expected: FAIL — Index renders a Redirect (no hero text).

- [ ] **Step 3: Implement**

```tsx
// mobile/app/(tabs)/index.tsx
import { LandingHome } from "@/components/landing/LandingHome";

// The app's front door. Everyone lands here; nav goes on to Library/Studio/etc.
export default function Index() {
  return <LandingHome />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest "app/(tabs)/__tests__/index.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx" "mobile/app/(tabs)/__tests__/index.test.tsx"
git commit -m "feat(landing): render Landing Home at / (was redirect to Library)"
```

---

### Task 5: `AccountMenu` (signed-in avatar popover)

**Files:**
- Create: `mobile/src/components/AccountMenu.tsx`
- Test: `mobile/src/components/__tests__/AccountMenu.test.tsx` (create)

**Interfaces:**
- Consumes: `useAuth` from `@/auth/AuthProvider` (returns `{ status, session, signOut: () => Promise<void> }`); `useRouter` from `expo-router`.
- Produces: `export function AccountMenu(): JSX.Element` — an avatar button that toggles a menu with Settings / Help / About / Sign out.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/components/__tests__/AccountMenu.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
const push = jest.fn(); const signOut = jest.fn().mockResolvedValue(undefined);
jest.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signed_in", session: { user: { email: "a@b.co" } }, signOut }) }));
import { AccountMenu } from "@/components/AccountMenu";

test("opens and lists account actions", () => {
  const { getByLabelText, getByText } = render(<AccountMenu />);
  fireEvent.press(getByLabelText(/account menu/i));
  ["Settings","Help","About","Sign out"].forEach((t) => expect(getByText(t)).toBeTruthy());
});

test("Sign out calls useAuth().signOut", () => {
  const { getByLabelText, getByText } = render(<AccountMenu />);
  fireEvent.press(getByLabelText(/account menu/i));
  fireEvent.press(getByText("Sign out"));
  expect(signOut).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/components/__tests__/AccountMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// mobile/src/components/AccountMenu.tsx
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useThemedStyles } from "@/theme";

const ITEMS: { label: string; href?: string; signOut?: boolean }[] = [
  { label: "Settings", href: "/settings" },
  { label: "Help", href: "/help" },
  { label: "About", href: "/about" },
  { label: "Sign out", signOut: true },
];

export function AccountMenu() {
  const s = useThemedStyles(make);
  const router = useRouter();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Account menu" style={s.avatar} onPress={() => setOpen((o) => !o)}>
        <Text style={s.avatarText}>⌄</Text>
      </Pressable>
      {open && (
        <View style={s.menu}>
          {ITEMS.map((it) => (
            <Pressable key={it.label} accessibilityRole="button" style={s.item}
              onPress={() => { setOpen(false); it.signOut ? void signOut() : it.href && router.push(it.href); }}>
              <Text style={s.itemText}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
const make = (t: any) => ({ /* avatar/menu/item styles from theme tokens: menu bg t.surface, border t.border, itemText t.text */ } as const);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/components/__tests__/AccountMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/AccountMenu.tsx mobile/src/components/__tests__/AccountMenu.test.tsx
git commit -m "feat(nav): AccountMenu popover (Settings/Help/About/Sign out)"
```

---

### Task 6: 2-state `TopNavBar` + `SideNav`

**Files:**
- Create: `mobile/src/components/navState.ts` (shared branch helper)
- Modify: `mobile/src/components/TopNavBar.tsx`, `mobile/src/components/SideNav.tsx`
- Test: `mobile/src/components/__tests__/navState.test.tsx` (create)

**Interfaces:**
- Consumes: `useAuth().status` (`"loading"|"signed_in"|"signed_out"|"unavailable"`); `NAV_ORDER`, `NAV_TABS`, `MARKETING_LINKS` from `./navItems`; `AccountMenu` from `./AccountMenu`.
- Produces: `export function navModel(status): { mode: "marketing" | "app"; showSignIn: boolean; showAccount: boolean }` where `signed_out → {marketing, showSignIn:true, showAccount:false}`, `signed_in → {app, false, true}`, `unavailable → {app, false, false}`, `loading → {app, false, false}` (Home only until resolved). Both bars import this so they stay in sync.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/components/__tests__/navState.test.tsx
import { navModel } from "@/components/navState";
test("marketing nav + Sign in when signed out", () => {
  expect(navModel("signed_out")).toEqual({ mode: "marketing", showSignIn: true, showAccount: false });
});
test("app nav + account when signed in", () => {
  expect(navModel("signed_in")).toEqual({ mode: "app", showSignIn: false, showAccount: true });
});
test("demo (unavailable): app nav, no sign-in, no account", () => {
  expect(navModel("unavailable")).toEqual({ mode: "app", showSignIn: false, showAccount: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/components/__tests__/navState.test.tsx`
Expected: FAIL — `navState` module not found.

- [ ] **Step 3: Implement**

```ts
// mobile/src/components/navState.ts
import type { AuthStatus } from "@/auth/AuthProvider";
export function navModel(status: AuthStatus) {
  if (status === "signed_out") return { mode: "marketing" as const, showSignIn: true, showAccount: false };
  if (status === "signed_in") return { mode: "app" as const, showSignIn: false, showAccount: true };
  return { mode: "app" as const, showSignIn: false, showAccount: false }; // unavailable | loading
}
```

Then wire both bars. In `TopNavBar` and `SideNav`: call `const { status } = useAuth(); const m = navModel(status);`.
- When `m.mode === "app"`: render the existing `NAV_ORDER`/`NAV_TABS` tiles (unchanged — now including the `home` tile from Task 2).
- When `m.mode === "marketing"`: render `MARKETING_LINKS` as text links; each `onPress` does `Platform.OS === "web" && document.getElementById(link.anchor)?.scrollIntoView({ behavior: "smooth" })`, and on native navigates to `/` (Home) where the sections live.
- When `m.showSignIn`: render a "Sign in" button → `router.push("/sign-in")`.
- When `m.showAccount`: render `<AccountMenu />` at the trailing edge.
- Keep the leading Mentible mark; repoint its `onPress` from `go("library")` to `go("home")` (or `router.push("/")`).

Do not duplicate the branch logic — both bars call `navModel`; only their layout (top row vs left column) differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/components/__tests__/navState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/navState.ts mobile/src/components/TopNavBar.tsx mobile/src/components/SideNav.tsx mobile/src/components/__tests__/navState.test.tsx
git commit -m "feat(nav): auth-state-aware TopNavBar/SideNav (marketing vs app + AccountMenu)"
```

---

### Task 7: Help topic + feature (DoD gate)

**Files:**
- Modify: `mobile/src/help-content/features.ts` (add `landing-home` feature)
- Modify: `mobile/src/help-content/topics.ts` (add a topic with `featureKey: "landing-home"`)
- Test: the existing `mobile/__tests__/help/coverage.test.ts` must stay green (no new test file; this task satisfies the coverage gate)

**Interfaces:**
- Consumes: the `FEATURES` array shape `{ key: string; label: string }` and the `TOPICS` shape (read `topics.ts` for the exact fields — each topic has an `id`, a `featureKey`, a `title`, and body content).
- Produces: `FEATURES` contains `{ key: "landing-home", label: "Home & navigation" }`; `TOPICS` contains a topic with `featureKey: "landing-home"`.

- [ ] **Step 1: Run the coverage gate to see it fail once the feature is added without a topic**

Add only the feature first:
```ts
// features.ts
  { key: "landing-home", label: "Home & navigation" },
```
Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: FAIL — declared feature `landing-home` has no topic.

- [ ] **Step 2: Add the topic**

In `topics.ts`, add a topic matching the file's existing shape, e.g.:
```ts
  {
    id: "home-and-nav",
    featureKey: "landing-home",
    title: "Home & navigation",
    // body/sections per the file's topic shape — explain: Home is the front door
    // (what Mentible does, the four phases, formats); the top bar shows marketing
    // links + Sign in before you sign in, and your Library/Studio/Projects/Reviews/
    // Publish tabs + account menu once you do.
  },
```
Match the real field names/structure of neighboring topics exactly.

- [ ] **Step 3: Run the gate to verify it passes**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "docs(help): Home & navigation topic (DoD coverage gate)"
```

---

## Final verification (whole-branch)

- [ ] **Run the FULL suite** (not a subset): `cd mobile && npx jest` — all green. `npx tsc --noEmit` clean.
- [ ] **Device/web verify** (mobile:verify skill): `/` shows the Landing Home; the top bar shows marketing links + Sign in when signed-out and app tabs + account menu when signed-in; `navy-trust` (navy+gold) is the default and renders cleanly across Home, Library, Studio, Projects, Settings.
