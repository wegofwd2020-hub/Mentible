# Studio P2 — App chrome + content sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Studio identity on the app shell — a branded Playfair wordmark header on stack screens + migrate the remaining content screens (Library/Books/Settings/Help/About) to the P1 primitives, plus the last P1 carryover (Add-source ghost).

**Architecture:** A new `StudioHeader` custom header wired once into the root `Stack` `screenOptions`, replacing the hardcoded native header colors; and a mechanical sweep of 5 content screens onto the P1 primitives (`Button`/`Card`/`Label`) + the Playfair heading convention already used by `projects.tsx`. Tokens are already studio-dark from P0 — this is typography + control-style, not a palette change. Reuse everything from P1; add no new primitive.

**Tech Stack:** React Native + Expo (expo-router `Stack` = `@react-navigation/native-stack`); TypeScript; Jest + React Native Testing Library.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-09-studio-p2-app-chrome-design.md`.
- **Reference pattern = `mobile/app/(tabs)/projects.tsx`** (P1-migrated). Heading style:
  `{ color: c.text, fontSize: typography.sizeLg, fontFamily: PLAYFAIR.semibold, letterSpacing: -0.36 }`
  with `import { PLAYFAIR } from "@/constants/fonts"`. Controls: `<Button variant="primary"|"ghost">`.
  Surfaces: `<Card>`. Eyebrows/meta: `<Label tone="muted"|"secondary">`. Import primitives from `@/components/ui`.
- **Retire `fontWeight: 600/700`** everywhere touched. Headings get Playfair (via `PLAYFAIR.semibold`/`.medium`), never a numeric bold weight. Playfair **≥16px floor** — never on `typography.sizeXs`(12)/`sizeSm` UI text; small labels stay Inter (use `<Label>`).
- **Ghost by default; one gold `variant="primary"` pill per view maximum.**
- `useThemedStyles`; assert role/family off `themes["studio-dark"]` or `PLAYFAIR.*` — **no color-literal test asserts** (a re-skin breaks them).
- `Button onPress: () => void` cannot carry an event — a control nested inside another Pressable that needs `e.stopPropagation()` stays a **raw Pressable**, not `<Button>`.
- `npx tsc --noEmit` clean + full `npx jest` green after every task.
- Mobile-only — **no backend refresh**. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/components/StudioHeader.tsx` — NEW: the wordmark header + `SECTION_KICKERS` map (T1)
- `mobile/app/_layout.tsx` — wire `header`, drop hardcoded header colors (T1)
- `mobile/app/trust/[projectId].tsx` — Add-source ghost + card/air tighten (T2)
- `mobile/src/components/TopNavBar.tsx`, `mobile/src/components/SideNav.tsx` — tile label weight 600→500 (T2)
- `mobile/app/(tabs)/library.tsx` (T3), `books.tsx` (T4), `settings.tsx` (T5), `help.tsx` + `about.tsx` (T6) — primitive sweep
- Tests: `mobile/__tests__/components/StudioHeader.test.tsx` (T1) + each screen's existing test updated

---

### Task 1: StudioHeader — wordmark bar + kicker map + wire into the Stack

**Files:**
- Create: `mobile/src/components/StudioHeader.tsx`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/__tests__/components/StudioHeader.test.tsx`

**Interfaces:**
- Produces: `StudioHeader(props: NativeStackHeaderProps): JSX.Element` and
  `SECTION_KICKERS: Record<string, string>` + `kickerFor(routeName: string, title?: string): string`.
- Consumes: `NativeStackHeaderProps` from `@react-navigation/native-stack`; `PLAYFAIR` from `@/constants/fonts`; `Label` from `@/components/ui`; `useThemedStyles`, `useSafeAreaInsets`.

- [ ] **Step 1: Write the failing test** (`StudioHeader.test.tsx`):
```tsx
import { render } from "@testing-library/react-native";
import { StudioHeader, kickerFor } from "@/components/StudioHeader";

const props = (over: any = {}) => ({
  navigation: { goBack: jest.fn() } as any,
  route: { name: "trust/[projectId]", key: "k", params: {} } as any,
  options: { title: "Project" } as any,
  back: { title: "Reviews" } as any,
  ...over,
});

describe("StudioHeader", () => {
  it("renders the wordmark and the curated kicker for a mapped route", () => {
    const { getByText } = render(<StudioHeader {...props()} />);
    expect(getByText("MENTIBLE")).toBeTruthy();
    expect(getByText("PROJECT")).toBeTruthy();     // SECTION_KICKERS["trust/[projectId]"]
  });
  it("falls back to the uppercased title for an unmapped route", () => {
    expect(kickerFor("some/unknown", "Widgets")).toBe("WIDGETS");
    expect(kickerFor("trust/new")).toBe("NEW PROJECT");   // mapped wins over title
  });
  it("shows a back control that calls goBack, and hides it when there is no back", () => {
    const goBack = jest.fn();
    const { getByLabelText, rerender, queryByLabelText } =
      render(<StudioHeader {...props({ navigation: { goBack } })} />);
    getByLabelText("Go back").props.onClick ?? // web
      getByLabelText("Go back").props.onPress();
    expect(goBack).toHaveBeenCalled();
    rerender(<StudioHeader {...props({ back: undefined })} />);
    expect(queryByLabelText("Go back")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/components/StudioHeader.test.tsx` (module not found).

- [ ] **Step 3: Implement `StudioHeader.tsx`.** READ `mobile/app/(tabs)/projects.tsx` for the token/PLAYFAIR conventions first. Then:
```tsx
import React from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, typography, type Palette } from "@/constants/theme";
import { PLAYFAIR } from "@/constants/fonts";
import { useThemedStyles } from "@/theme";
import { Label } from "@/components/ui";

// Curated per-route kickers (Studio P2). Keyed by route.name; unmapped routes
// fall back to the uppercased screen title so nothing renders blank.
export const SECTION_KICKERS: Record<string, string> = {
  "trust/[projectId]": "PROJECT",
  "trust/new": "NEW PROJECT",
  "trust/version/[versionId]": "DRAFT",
  "trust/topic-version/[id]": "DRAFT",
  "book/new": "NEW BOOK",
  "book/saved/[id]": "EDIT BOOK",
  "book/generate/[id]": "WRITE TOPICS",
  "book/topic/[bookId]/[topicId]": "TOPIC",
  "book/read/[id]": "READ",
  "book/reviews/[id]": "REVIEWS",
  account: "ACCOUNT",
  usage: "USAGE",
  paywall: "PLANS",
  admin: "ADMIN",
  "admin/[sub]": "USER",
  "sign-in": "SIGN IN",
  concepts: "PROTOTYPE",
  "diagram-types": "DIAGRAM TYPES",
};

export function kickerFor(routeName: string, title?: string): string {
  return SECTION_KICKERS[routeName] ?? (title ?? "").toUpperCase();
}

export function StudioHeader({ navigation, route, options, back }: NativeStackHeaderProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const kicker = kickerFor(route.name, options.title);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.xs }]}>
      {back ? (
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backBtn}
        >
          <Text style={styles.chevron}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.backBtn} />
      )}
      <View style={styles.titles}>
        <Text style={styles.wordmark} numberOfLines={1}>MENTIBLE</Text>
        {kicker ? <Label style={styles.kicker}>{kicker}</Label> : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  bar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: c.background,
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: "center" as const, justifyContent: "center" as const },
  chevron: { color: c.text, fontSize: typography.sizeXl },
  titles: { flex: 1 },
  // Playfair wordmark — ≥16px floor honoured (sizeLg=18). Medium weight, never bold.
  wordmark: { color: c.text, fontSize: typography.sizeLg, fontFamily: PLAYFAIR.medium, letterSpacing: 1 },
  kicker: { marginTop: 1 },   // <Label> already: uppercase, tracked, muted, 500
});
```
Then in `mobile/app/_layout.tsx`: `import { StudioHeader } from "@/components/StudioHeader";` and in the `Stack` `screenOptions` REMOVE `headerStyle`/`headerTintColor`/`headerTitleStyle` and ADD `header: (props) => <StudioHeader {...props} />`. Change the hardcoded `contentStyle: { backgroundColor: "#0f172a" }` to the theme background — import the studio-dark background token (or reuse the existing `colors.background` import already used at line ~37 for the splash hold). Leave every `<Stack.Screen>` `title`/`headerBackTitle`/`headerShown:false` exactly as-is.

- [ ] **Step 4: Run test + tsc** — `cd mobile && npx jest __tests__/components/StudioHeader.test.tsx && npx tsc --noEmit`. If the back-control assertion is brittle on the RN/web split, assert `getByLabelText("Go back")` exists + fire `fireEvent.press`. Adjust the test to the harness (don't weaken: still assert goBack is called and the control disappears when `back` is undefined).

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/components/StudioHeader.tsx mobile/app/_layout.tsx mobile/__tests__/components/StudioHeader.test.tsx
git commit -m "feat(studio): P2 wordmark StudioHeader on stack screens (Studio P2 T1)"
```

---

### Task 2: P1 carryover — Add-source ghost + [projectId] tighten + nav label weight

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Modify: `mobile/src/components/TopNavBar.tsx`, `mobile/src/components/SideNav.tsx`

**Interfaces:** none new — uses the existing `Button` variant prop + the `tileLabel` style.

- [ ] **Step 1: Adjust the tests first.** In `TopNavBar`/`SideNav` tests (if any assert weight) and any `[projectId]` test asserting the Add-source button, update expectations: Add-source is now `variant="ghost"`; tile label weight is `"500"`. If no test asserts these, add a small assertion to the nav test that `makeStyles(themes["studio-dark"]).tileLabel.fontWeight === "500"` (import `themes` from the theme module). READ the existing nav test to match its style.

- [ ] **Step 2: Implement.**
  - `mobile/app/trust/[projectId].tsx`: find the "Add source" `<Button variant="primary" …>` (full-width gold pill) and change `variant="primary"` → `variant="ghost"`. Leave label/onPress. If a card border/vertical-air value visibly lags the reference (`projects.tsx` uses `<Card>` default padding + `gap: spacing.sm` lists), nudge those list/card styles toward the reference — do NOT restyle unrelated blocks.
  - `mobile/src/components/TopNavBar.tsx` (`tileLabel`) and `mobile/src/components/SideNav.tsx` (its equivalent label style): `fontWeight: "600"` → `fontWeight: "500"`. Nothing else on the tiles changes.

- [ ] **Step 3: Run** — `cd mobile && npx jest __tests__ -t "TopNav|SideNav|Project" && npx tsc --noEmit` (or the nearest existing test names). Full-suite check happens in final verification.

- [ ] **Step 4: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/src/components/TopNavBar.tsx mobile/src/components/SideNav.tsx mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): P2 Add-source ghost + nav label weight 500 + [projectId] tighten (Studio P2 T2)"
```

---

### Task 3: Library screen — primitive sweep

**Files:**
- Modify: `mobile/app/(tabs)/library.tsx`
- Test: its existing test under `mobile/__tests__/` (update assertions as needed)

**Interfaces:** consumes `Button`/`Card`/`Label` from `@/components/ui`, `PLAYFAIR` from `@/constants/fonts`.

- [ ] **Step 1: READ `library.tsx` fully + the reference `projects.tsx`.** Identify each of the ~5 `fontWeight: 600/700` heading styles, each ad-hoc filled control, and each ad-hoc card container.

- [ ] **Step 2: Update/write the test.** READ the existing library test; convert any assertion that reads a raw heading `<Text>` or a raw button into asserting the same content through the primitive (e.g. `getByText` for the title still works inside `<Card>`; a control asserts via `getByRole("button", { name })`). Assert no rendered heading style carries `fontWeight: "700"` (or assert the title style uses `PLAYFAIR.semibold`). **No color-literal asserts.** If library has no test, add a thin render test asserting the screen mounts + the primary action is a single `variant="primary"` control.

- [ ] **Step 3: Implement the sweep** (mirror `projects.tsx`):
  - Add `import { PLAYFAIR } from "@/constants/fonts";` and `import { Button, Card, Label } from "@/components/ui";`.
  - Each heading style → `{ color: c.text, fontSize: typography.sizeLg /* or sizeXl for a screen title */, fontFamily: PLAYFAIR.semibold, letterSpacing: -0.36 }`; drop the `fontWeight`.
  - Ad-hoc card `View`s wrapping list rows/sections → `<Card style={layoutOnlyStyle}>` (keep flexDirection/align as a layout-only style, per the `row` comment in projects.tsx).
  - Filled/ad-hoc `Pressable` action buttons → `<Button variant="ghost">`, EXCEPT the single most-important action which may stay `variant="primary"` (one gold pill max). A row that is itself a `Pressable` navigation target with a nested action stays a raw Pressable (event-bubbling rule).
  - Section eyebrows / metadata captions → `<Label tone="muted"|"secondary">`.
  - Small (≤14px) labels stay Inter — do NOT put Playfair on them.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Ll]ibrary" && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/(tabs)/library.tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): P2 Library adopts primitives + Playfair headings (Studio P2 T3)"
```

---

### Task 4: Books screen — primitive sweep

**Files:**
- Modify: `mobile/app/(tabs)/books.tsx`
- Test: its existing test (update as needed)

- [ ] **Step 1: READ `books.tsx` fully** (has the most raw weights — ~10) + `projects.tsx`.

- [ ] **Step 2: Update/write the test** — same rubric as Task 3 Step 2 (content survives via primitives; no `fontWeight:"700"` in headings; no color literals).

- [ ] **Step 3: Implement the sweep** — identical rubric to Task 3 Step 3 applied to `books.tsx`: imports, heading→PLAYFAIR (drop weight), ad-hoc cards→`<Card>`, filled controls→`<Button>` (ghost default, one gold pill max), eyebrows→`<Label>`, keep small labels Inter, keep nested-in-Pressable actions raw.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Bb]ooks" && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/(tabs)/books.tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): P2 Books adopts primitives + Playfair headings (Studio P2 T4)"
```

---

### Task 5: Settings screen — primitive sweep

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`
- Test: its existing test (update as needed)

- [ ] **Step 1: READ `settings.tsx` fully** (~6 raw weights) + `projects.tsx`. Note: Settings has the theme switcher + BYOK/account rows — keep their behavior untouched; only re-skin their labels/containers/buttons.

- [ ] **Step 2: Update/write the test** — same rubric (content survives; headings not 700; **switcher + BYOK behavior assertions stay green and unchanged** — this is re-skin only).

- [ ] **Step 3: Implement the sweep** — same rubric as Task 3 applied to `settings.tsx`. Setting-row group headers → PLAYFAIR heading; row labels → `<Label>`/body Inter; destructive/primary actions → `<Button>` (ghost default; a single primary if one action dominates). Do NOT change the theme switcher's options or the BYOK key handling.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Ss]ettings" && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/(tabs)/settings.tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): P2 Settings adopts primitives + Playfair headings (Studio P2 T5)"
```

---

### Task 6: Help + About screens — primitive sweep

**Files:**
- Modify: `mobile/app/(tabs)/help.tsx`, `mobile/app/(tabs)/about.tsx`
- Test: their existing tests (update as needed)

- [ ] **Step 1: READ both files** (help ~1 weight, about ~3) + `projects.tsx`. Help renders Help topics as data — keep the topic data/rendering behavior; only re-skin the chrome (section headers, cards, links).

- [ ] **Step 2: Update/write the tests** — same rubric. **The Help coverage gate (`mobile/__tests__/help/coverage.test.ts`) must stay green** — P2 adds no feature keys; do not touch `features.ts`/`topics.ts`.

- [ ] **Step 3: Implement the sweep** — same rubric as Task 3 applied to `help.tsx` and `about.tsx`: imports, heading→PLAYFAIR, cards→`<Card>`, links/buttons→`<Button variant="ghost">`, eyebrows→`<Label>`.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Hh]elp|[Aa]bout" && npx jest __tests__/help/coverage.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/(tabs)/help.tsx" "mobile/app/(tabs)/about.tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): P2 Help + About adopt primitives + Playfair headings (Studio P2 T6)"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest` — full suite green.
- [ ] `cd mobile && npx tsc --noEmit && npx eslint .` (or the repo's lint script) — clean.
- [ ] **Device/web screenshot verify** (jsdom is Yoga-blind — the flexbox + Playfair traps only show here; mirror the P1 verify recipe [[project_studio_reskin]]):
  - StudioHeader renders on a stack screen (open a Project) — wordmark in Playfair (not collapsed to Inter/Regular), correct kicker, back chevron works.
  - Toggle dyslexic mode → the wordmark + swept headings become OpenDyslexic, NOT Playfair-Regular-collapsed (the P0 dyslexic-heading bug).
  - Library/Books/Settings/Help/About: headings render Playfair, no text-collapse, cards show the hairline border, Add-source reads as a ghost pill, nav tiles still stretch (flex-item trap).
- [ ] PR body: mobile-only chrome + sweep; **web redeploy only, NO backend refresh**; screenshots of the header + one swept screen.

## Self-Review

- **Spec coverage:** StudioHeader + wiring (T1) · Add-source ghost + nav weight + tighten (T2) · Library/Books/Settings/Help/About sweep (T3–T6). Nav tiles kept (only weight nudged); posts/shelves + P3/P4 out of scope — matches the spec.
- **Type consistency:** `StudioHeader`/`kickerFor`/`SECTION_KICKERS` signatures match T1's test + the `_layout.tsx` wiring. The sweep tasks all consume the same `@/components/ui` exports + `PLAYFAIR` from `@/constants/fonts`, the exact imports `projects.tsx` uses.
- **Placeholders:** none — StudioHeader ships as complete code + the kicker map; each sweep task names the concrete file, the reference, and the mechanical rubric (the implementer reads the target screen for its specific styles).
- **Constraints:** Playfair ≥16px (wordmark at sizeLg=18; small labels stay `<Label>`/Inter); retire 600/700 (nav→500); ghost-default + one gold pill; no color-literal asserts; nested-in-Pressable actions stay raw; no backend refresh.
