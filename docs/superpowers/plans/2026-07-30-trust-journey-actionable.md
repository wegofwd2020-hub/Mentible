# Trust Journey — Actionable Next-Step (Phase B slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `TrustJourney` next-step tappable — in the project workspace it scrolls to the relevant control (Sources / Artifacts / Owner-actions) and the Share step opens the Posts tab.

**Architecture:** `TrustJourney` gains an optional `onNext(phaseKey)` — when present the next-step renders as a `Pressable`; when absent, plain text (backward-compatible). The workspace supplies `onNext`, captures three section Y positions via `onLayout`, and `scrollTo`s the `ScrollView` (or routes to `/posts` for Share).

**Tech Stack:** React Native + Expo, TypeScript, Jest/RNTL. Mobile only, no backend change.

## Global Constraints
- **Backward-compatible:** `onNext` is optional; without it `TrustJourney` renders the plain `<Text>` exactly as today (existing TrustJourney tests must pass unchanged).
- **Keep the workspace's static `colors`/`StyleSheet`** — no theme migration.
- **Scroll-to is device-verified**, not unit-tested (RN `scrollTo` side-effects aren't meaningfully assertable). Unit tests cover: the button calls `onNext(phaseKey)`, and the Share phase routes to `/posts`.
- **Mobile:** `npm test`; `npx tsc --noEmit` (baseline 0); **`npx eslint <files>` before each commit** (CI lints — named components, no unused imports).
- No Help change (behavior-only; the `projects` topic already covers the journey) — no new FEATURES key.

---

### Task 1: `TrustJourney` — optional tappable `onNext`

**Files:**
- Modify: `mobile/src/components/TrustJourney.tsx`
- Test: `mobile/__tests__/components/TrustJourney.test.tsx` (extend)

**Interfaces:**
- Produces: `TrustJourney({ detail, isOwner, onNext? }: { detail: ProjectDetailView; isOwner: boolean; onNext?: (phaseKey: string) => void })`.

- [ ] **Step 1: Add the failing test**

Append to `mobile/__tests__/components/TrustJourney.test.tsx` (the file's `detail()`/`withVersion()` helpers already exist):
```tsx
import { fireEvent } from "@testing-library/react-native";

it("with onNext, the next step is a button that reports the current phase key", () => {
  const onNext = jest.fn();
  render(<TrustJourney detail={detail()} isOwner onNext={onNext} />); // no data → capture
  fireEvent.press(screen.getByLabelText(/Go to next step/i));
  expect(onNext).toHaveBeenCalledWith("capture");
});

it("with onNext, a validated project reports the share phase key", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }], ...withVersion(true) });
  const onNext = jest.fn();
  render(<TrustJourney detail={d} isOwner onNext={onNext} />);
  fireEvent.press(screen.getByLabelText(/Go to next step/i));
  expect(onNext).toHaveBeenCalledWith("share");
});

it("without onNext, the next step is plain text (not a button)", () => {
  render(<TrustJourney detail={detail()} isOwner />);
  expect(screen.queryByLabelText(/Go to next step/i)).toBeNull();
  expect(screen.getByText(/add a source/i)).toBeTruthy();
});
```
Ensure `fireEvent` is imported at the top of the file (add to the existing `@testing-library/react-native` import if not already there).

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npm test -- __tests__/components/TrustJourney.test.tsx`
Expected: FAIL — no "Go to next step" button.

- [ ] **Step 3: Implement**

In `mobile/src/components/TrustJourney.tsx`:
- Add `Pressable` to the `react-native` import.
- Change the signature to `{ detail, isOwner, onNext }: { detail: ProjectDetailView; isOwner: boolean; onNext?: (phaseKey: string) => void }`.
- Compute the text once and branch the render:
```tsx
  const currentKey = phases[currentIdx].key;
  const nextText = nextStep(currentKey, isOwner);
  ...
      {onNext ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go to next step: ${nextText}`}
          onPress={() => onNext(currentKey)}
        >
          <Text style={styles.nextTappable}>{nextText} →</Text>
        </Pressable>
      ) : (
        <Text style={styles.next}>{nextText}</Text>
      )}
```
- Add a `nextTappable` style: same as `next` but `color: colors.primary, fontWeight: "600"`.

- [ ] **Step 4: Run test + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/components/TrustJourney.test.tsx && npx tsc --noEmit && npx eslint src/components/TrustJourney.tsx __tests__/components/TrustJourney.test.tsx`
Expected: PASS (all TrustJourney tests, old + 3 new) + 0 type errors + eslint clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/TrustJourney.tsx mobile/__tests__/components/TrustJourney.test.tsx
git commit -m "feat(trust): TrustJourney optional tappable onNext (ADR-037 Phase B slice 2)"
```

---

### Task 2: Workspace scroll wiring

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1's `TrustJourney onNext`. Produces: an `onNextAction(phaseKey)` handler wired to the Journey that scrolls to the section / routes to `/posts`.

**Notes:** READ the current `app/trust/[projectId].tsx`. Imports today: `import { useLocalSearchParams } from "expo-router"`, `import { useState } from "react"`, `ScrollView` from react-native. The render is one `<ScrollView>` → `<PageContainer>` → title/topic → `<TrustJourney …/>` → `<View style={styles.sourcesBlock}>` → artifacts `.map` (`<View style={styles.artifact}>` per item) → `<View style={styles.ownerBlock}>`.

- [ ] **Step 1: Add the failing test**

Extend `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx`:
- Update the file's `expo-router` mock to include `push`: `useRouter: () => ({ back: jest.fn(), push: mockPush })` with a top-level `const mockPush = jest.fn()` (reset in `beforeEach`).
- New test: mock `useTrustProject` to return a **validated** project (an artifact with a `versions:[{is_validated:true}]` and non-empty `inputs`) so the Journey's current phase is Share; render; `fireEvent.press(screen.getByLabelText(/Go to next step/i))`; assert `mockPush` was called with `"/posts"`.
- New test: a capture-phase project (no inputs) → pressing the next-step does NOT throw (scroll is a no-op under the test renderer) and does NOT call `mockPush`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx`
Expected: FAIL — the next-step isn't a button yet / no `onNext` wired.

- [ ] **Step 3: Implement the wiring**

In `mobile/app/trust/[projectId].tsx`:
- Imports: `import { useLocalSearchParams, useRouter } from "expo-router";` and `import { useRef, useState } from "react";`.
- In the component: `const router = useRouter();` and refs:
```tsx
  const scrollRef = useRef<ScrollView>(null);
  const sourcesY = useRef(0);
  const artifactsY = useRef(0);
  const ownerActionsY = useRef(0);

  const onNextAction = (phaseKey: string) => {
    const scrollTo = (y: number) => scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
    switch (phaseKey) {
      case "capture": scrollTo(sourcesY.current); break;
      case "create": scrollTo(artifactsY.current); break;
      case "validate": scrollTo(isOwner ? ownerActionsY.current : artifactsY.current); break;
      default: router.push("/posts"); break; // share
    }
  };
```
  (Define `onNextAction` after `isOwner` is computed.)
- `<ScrollView ref={scrollRef} …>` (add the ref to the existing ScrollView).
- `<TrustJourney detail={project} isOwner={isOwner} onNext={onNextAction} />`.
- `onLayout` anchors:
  - On `<View style={styles.sourcesBlock}` add `onLayout={(e) => { sourcesY.current = e.nativeEvent.layout.y; }}`.
  - **Wrap the artifacts `.map` in a single `<View onLayout={(e) => { artifactsY.current = e.nativeEvent.layout.y; }}>…{artifacts.map(...)}…</View>`** (a plain wrapper — no style needed; keeps the artifacts region as one anchor).
  - On `<View style={styles.ownerBlock}` add `onLayout={(e) => { ownerActionsY.current = e.nativeEvent.layout.y; }}`.

- [ ] **Step 4: Run new + all existing detail tests + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/screens/TrustProjectDetail.sources.test.tsx __tests__/screens/TrustProjectDetail.generate.test.tsx && npx tsc --noEmit && npx eslint "app/trust/[projectId].tsx" __tests__/screens/TrustProjectDetail.journey.test.tsx`
Expected: all pass. The other detail tests render the workspace (now the Journey is a Pressable) — their `useRouter` mock only has `back`, but `router.push` is only invoked on a Share-step press they never perform, so they're unaffected. 0 type errors, eslint clean.

- [ ] **Step 5: Full suite + commit**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: full suite green, 0 type errors.
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx
git commit -m "feat(trust): actionable Journey — scroll to control / open Posts (ADR-037 Phase B slice 2)"
```

---

## Final verification (after all tasks)
`cd mobile && npm test && npx tsc --noEmit && npx eslint src/components/TrustJourney.tsx "app/trust/[projectId].tsx"`
Expected: full suite green, 0 type errors, eslint clean.

Device/web re-verify (JS-only → Metro reload): open a project → tap the Journey next-step → the screen scrolls to the matching control; on a validated project, tapping Share opens the Posts tab.

## Self-Review notes (author)
- **Spec coverage:** `onNext` tappable next-step = Task 1; workspace scroll anchors + `onNextAction` + Share→`/posts` = Task 2.
- **Backward-compat:** `onNext` optional; Task 1's third test proves plain-text render without it; the other detail tests keep passing (they don't press the next-step).
- **Type consistency:** `onNext?: (phaseKey: string) => void` (Task 1) consumed by `onNextAction` (Task 2) with the exact signature; `scrollRef` typed `useRef<ScrollView>(null)`.
- **Testability limit noted:** scroll position is device-verified; unit tests assert the button→`onNext` call + Share→`push("/posts")` (the two deterministic behaviors).
- **Risk flagged:** the artifacts-map wrapper `<View>` is a structural add — confirm it doesn't change layout (a plain wrapper with no style is transparent to flex); Task 2 Step 4 runs all detail tests. The `useRouter` mock in the journey test must add `push`.
