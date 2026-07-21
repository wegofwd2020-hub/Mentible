# Discovery Nudges (F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advertise the moat with proactive, dismissible, once-per-key in-context nudges — a "make a quiz from this chapter" nudge on the reading screen and a "download a free book" nudge on Shelves.

**Architecture:** A new `mobile/src/discovery/` module: `nudgeStore` (AsyncStorage set of dismissed keys) → `useNudge(key)` hook (`{ visible, dismiss }`, hidden until the set loads) → `DiscoveryNudge` presentational callout. Two screens render a nudge gated on `visible` AND a caller-owned eligibility condition.

**Tech Stack:** React Native + Expo · TypeScript · `@react-native-async-storage/async-storage` · `@expo/vector-icons` (Ionicons) · jest-expo + `@testing-library/react-native`. All commands run from `mobile/`.

## Global Constraints

- **Fail closed:** a nudge is hidden until the dismissed-set load resolves, and stays hidden if the load throws. A discovery hint must never crash a screen or flash.
- **One-and-done:** dismissal is persisted per key (`sbq_dismissed_nudges`); a dismissed nudge never reappears. No show-N-times logic.
- **No new Help `FEATURES` key** — nudges advertise features that already have Help topics. `coverage.test.ts` and `starter-claim.test.ts` must still pass unchanged.
- **Demo-safe:** the chapter-quiz nudge is gated on the same `showTrigger` (`= !IS_DEMO`) as the quiz action it advertises.
- **Copy (verbatim):** chapter-quiz = `"New — make a quiz from this chapter to test yourself."`; shelves-download = `"Tap a curated shelf to download a free book to read."`
- **Store key (verbatim):** `sbq_dismissed_nudges`. Nudge keys: `chapter-quiz`, `shelves-download`.

---

### Task 1: `nudgeStore` — persisted dismissed-set

**Files:**
- Create: `mobile/src/discovery/nudgeStore.ts`
- Test: `mobile/src/discovery/__tests__/nudgeStore.test.ts`

**Interfaces:**
- Produces: `loadDismissed(): Promise<string[]>`, `dismissNudge(key: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadDismissed, dismissNudge } from "../nudgeStore";

beforeEach(async () => { await AsyncStorage.clear(); });

it("returns [] when nothing dismissed", async () => {
  expect(await loadDismissed()).toEqual([]);
});

it("persists a dismissed key", async () => {
  await dismissNudge("chapter-quiz");
  expect(await loadDismissed()).toEqual(["chapter-quiz"]);
});

it("is idempotent — dismissing twice keeps one entry", async () => {
  await dismissNudge("chapter-quiz");
  await dismissNudge("chapter-quiz");
  expect(await loadDismissed()).toEqual(["chapter-quiz"]);
});

it("returns [] on corrupt storage", async () => {
  await AsyncStorage.setItem("sbq_dismissed_nudges", "not json");
  expect(await loadDismissed()).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/discovery/__tests__/nudgeStore.test.ts`
Expected: FAIL — "Cannot find module '../nudgeStore'".

- [ ] **Step 3: Implement**

```ts
// Persisted set of dismissed discovery-nudge keys (F3). Mirrors the seed-marker
// style (seedStarterSources). Parse-safe; a corrupt blob reads as empty.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sbq_dismissed_nudges";

export async function loadDismissed(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function dismissNudge(key: string): Promise<void> {
  const cur = await loadDismissed();
  if (cur.includes(key)) return;
  cur.push(key);
  await AsyncStorage.setItem(KEY, JSON.stringify(cur));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/discovery/__tests__/nudgeStore.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/discovery/nudgeStore.ts mobile/src/discovery/__tests__/nudgeStore.test.ts
git commit -m "feat(discovery): persisted dismissed-nudge store"
```

---

### Task 2: `useNudge` hook

**Files:**
- Create: `mobile/src/discovery/useNudge.ts`
- Test: `mobile/src/discovery/__tests__/useNudge.test.ts`

**Interfaces:**
- Consumes: `loadDismissed`, `dismissNudge` (Task 1).
- Produces: `useNudge(key: string): { visible: boolean; dismiss: () => void }`.

- [ ] **Step 1: Write the failing test**

```ts
import { renderHook, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNudge } from "../useNudge";
import * as store from "../nudgeStore";

beforeEach(async () => { await AsyncStorage.clear(); jest.restoreAllMocks(); });

it("starts hidden, becomes visible after load when not dismissed", async () => {
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  expect(result.current.visible).toBe(false); // hidden until load resolves
  await waitFor(() => expect(result.current.visible).toBe(true));
});

it("stays hidden when already dismissed", async () => {
  await store.dismissNudge("chapter-quiz");
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  await waitFor(() => {});
  expect(result.current.visible).toBe(false);
});

it("dismiss hides it and persists", async () => {
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  await waitFor(() => expect(result.current.visible).toBe(true));
  act(() => { result.current.dismiss(); });
  expect(result.current.visible).toBe(false);
  await waitFor(async () => expect(await store.loadDismissed()).toContain("chapter-quiz"));
});

it("fails closed when the load rejects", async () => {
  jest.spyOn(store, "loadDismissed").mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  await waitFor(() => {});
  expect(result.current.visible).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/discovery/__tests__/useNudge.test.ts`
Expected: FAIL — "Cannot find module '../useNudge'".

- [ ] **Step 3: Implement**

```ts
// Proactive one-and-done nudge visibility (F3). Hidden until the dismissed set
// loads (D4 fail-closed); dismiss persists so it never reappears.
import { useCallback, useEffect, useState } from "react";
import { dismissNudge, loadDismissed } from "./nudgeStore";

export function useNudge(key: string): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    loadDismissed()
      .then((dismissed) => { if (active && !dismissed.includes(key)) setVisible(true); })
      .catch(() => { /* fail closed: stay hidden */ });
    return () => { active = false; };
  }, [key]);
  const dismiss = useCallback(() => {
    setVisible(false);
    void dismissNudge(key).catch(() => { /* swallow: worst case it reappears next launch */ });
  }, [key]);
  return { visible, dismiss };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/discovery/__tests__/useNudge.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/discovery/useNudge.ts mobile/src/discovery/__tests__/useNudge.test.ts
git commit -m "feat(discovery): useNudge hook (fail-closed, one-and-done)"
```

---

### Task 3: `DiscoveryNudge` component

**Files:**
- Create: `mobile/src/discovery/DiscoveryNudge.tsx`
- Test: `mobile/src/discovery/__tests__/DiscoveryNudge.test.tsx`

**Interfaces:**
- Produces: `DiscoveryNudge({ text, onDismiss, testID }: { text: string; onDismiss: () => void; testID?: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, fireEvent } from "@testing-library/react-native";
import { DiscoveryNudge } from "../DiscoveryNudge";

it("renders the text and fires onDismiss when × pressed", () => {
  const onDismiss = jest.fn();
  const { getByText, getByLabelText } = render(
    <DiscoveryNudge text="Make a quiz" onDismiss={onDismiss} testID="nudge-x" />,
  );
  expect(getByText("Make a quiz")).toBeTruthy();
  fireEvent.press(getByLabelText("Dismiss hint"));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/discovery/__tests__/DiscoveryNudge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (styled after `HelpHint`/`TourStep` + `@/constants/theme` tokens)

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A proactive, dismissible discovery callout (F3) — unlike HelpHint (passive
// tap-to-reveal), this advertises an action the user may not know exists. It
// sits next to the real control; dismissal is owned by the caller (useNudge).
export interface DiscoveryNudgeProps {
  text: string;
  onDismiss: () => void;
  testID?: string;
}

export function DiscoveryNudge({ text, onDismiss, testID }: DiscoveryNudgeProps) {
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
      <Text style={styles.text}>{text}</Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss hint"
        testID={testID ? `${testID}-dismiss` : undefined}
      >
        <Text style={styles.dismiss}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary + "1A", // translucent primary tint (cf. TourStep's +"33")
    marginVertical: spacing.sm,
  },
  text: { flex: 1, color: colors.text, fontSize: typography.sizeSm },
  dismiss: { color: colors.textSecondary, fontSize: typography.sizeMd, fontWeight: "700", paddingHorizontal: spacing.xs },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/discovery/__tests__/DiscoveryNudge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/discovery/DiscoveryNudge.tsx mobile/src/discovery/__tests__/DiscoveryNudge.test.tsx
git commit -m "feat(discovery): DiscoveryNudge proactive callout component"
```

---

### Task 4: Wire the chapter-quiz nudge (the core moat nudge)

**Files:**
- Modify: `mobile/app/book/chapter/[bookId]/[chapterId].tsx` (insert the nudge directly above the `{showTrigger && (<View style={styles.quizBar}>…)}` block, ~line 89)
- Test: `mobile/__tests__/app/chapter-quiz.test.tsx` (existing — add cases)

**Interfaces:**
- Consumes: `useNudge` (Task 2), `DiscoveryNudge` (Task 3).

- [ ] **Step 1: Write the failing tests** (add to the existing chapter-quiz test file; follow its render/mock setup)

The nudge must appear when the quiz trigger is shown and the nudge is undismissed, and be absent when dismissed. Mock `@/discovery/useNudge` to control `visible`:

```tsx
jest.mock("@/discovery/useNudge", () => ({
  useNudge: () => ({ visible: mockNudgeVisible, dismiss: jest.fn() }),
}));
let mockNudgeVisible = true;

it("shows the chapter-quiz nudge when the quiz trigger is available", async () => {
  mockNudgeVisible = true;
  const { findByTestId } = renderChapter(); // use the file's existing render helper
  expect(await findByTestId("nudge-chapter-quiz")).toBeTruthy();
});

it("hides the nudge once dismissed", async () => {
  mockNudgeVisible = false;
  const { queryByTestId } = renderChapter();
  expect(queryByTestId("nudge-chapter-quiz")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/app/chapter-quiz.test.tsx -t "nudge"`
Expected: FAIL — testID `nudge-chapter-quiz` not found.

- [ ] **Step 3: Implement the wiring**

Add imports:
```tsx
import { useNudge } from "@/discovery/useNudge";
import { DiscoveryNudge } from "@/discovery/DiscoveryNudge";
```
In the component body (near the other hooks):
```tsx
  const quizNudge = useNudge("chapter-quiz");
```
Insert directly above the existing `{showTrigger && (<View style={styles.quizBar}>` block:
```tsx
        {showTrigger && quizNudge.visible && (
          <DiscoveryNudge
            text="New — make a quiz from this chapter to test yourself."
            onDismiss={quizNudge.dismiss}
            testID="nudge-chapter-quiz"
          />
        )}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/app/chapter-quiz.test.tsx && npx tsc --noEmit`
Expected: PASS (new + existing), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/book/chapter/[bookId]/[chapterId].tsx" mobile/__tests__/app/chapter-quiz.test.tsx
git commit -m "feat(discovery): chapter-quiz nudge advertises Make-a-quiz"
```

---

### Task 5: Wire the shelves-download nudge

**Files:**
- Modify: `mobile/app/(tabs)/shelves.tsx` (insert the nudge above the `styles.listHeader` block, ~line 77)
- Test: `mobile/__tests__/app/shelves.test.tsx` (existing — add cases)

**Interfaces:**
- Consumes: `useNudge` (Task 2), `DiscoveryNudge` (Task 3). Eligibility: a starter source present.

- [ ] **Step 1: Write the failing tests** (add to the existing shelves test file; follow its render/mock setup — it drives `sources` from a mocked `useOpenShelves`)

```tsx
jest.mock("@/discovery/useNudge", () => ({
  useNudge: () => ({ visible: mockNudgeVisible, dismiss: jest.fn() }),
}));
let mockNudgeVisible = true;

it("shows the shelves-download nudge when a starter shelf is present", async () => {
  mockNudgeVisible = true;
  // arrange the mocked hook state so sources includes an isStarter:true source
  const { findByTestId } = renderShelves();
  expect(await findByTestId("nudge-shelves-download")).toBeTruthy();
});

it("hides the nudge when no starter shelf is present", () => {
  mockNudgeVisible = true;
  // arrange sources with NO isStarter source
  const { queryByTestId } = renderShelves();
  expect(queryByTestId("nudge-shelves-download")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/app/shelves.test.tsx -t "shelves-download nudge"`
Expected: FAIL — testID not found.

- [ ] **Step 3: Implement the wiring**

Add imports:
```tsx
import { useNudge } from "@/discovery/useNudge";
import { DiscoveryNudge } from "@/discovery/DiscoveryNudge";
```
In the component body:
```tsx
  const dlNudge = useNudge("shelves-download");
  const hasStarter = shelves.sources.some((s) => s.isStarter);
```
Insert directly above `<View style={styles.listHeader}>`:
```tsx
        {hasStarter && dlNudge.visible && (
          <DiscoveryNudge
            text="Tap a curated shelf to download a free book to read."
            onDismiss={dlNudge.dismiss}
            testID="nudge-shelves-download"
          />
        )}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/app/shelves.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/shelves.tsx" mobile/__tests__/app/shelves.test.tsx
git commit -m "feat(discovery): shelves-download nudge points at starter shelves"
```

---

### Final: full-suite gate

- [ ] **Step 1: Mobile**

Run (from `mobile/`): `npx tsc --noEmit && npx eslint . && npx jest`
Expected: tsc clean, eslint 0 errors, all tests pass — including `coverage.test.ts` and `starter-claim.test.ts` unchanged (no `FEATURES` key added).
