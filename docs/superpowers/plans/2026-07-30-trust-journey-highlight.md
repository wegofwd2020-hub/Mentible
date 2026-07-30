# Trust Journey — Post-Scroll Highlight (Phase B slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the Journey next-step scrolls to a control, briefly highlight that section (border-color → primary, ~1.5s) so the user's eye lands on the right place.

**Architecture:** Workspace-only. A `highlight` state + a timer; `onNextAction` sets the highlight alongside the scroll (Share routes away, no highlight); the three anchored sections swap `borderColor` to `colors.primary` when highlighted (width unchanged → no layout shift). `TrustJourney` is untouched.

**Tech Stack:** React Native + Expo, TypeScript, Jest/RNTL. Mobile only, no backend.

## Global Constraints
- One production file: `mobile/app/trust/[projectId].tsx`. `TrustJourney` unchanged. No backend, no Help/FEATURES change.
- **No layout shift:** highlight = border **color** swap only (all three sections already have `borderWidth: 1`; the style-less artifacts wrapper gets a base transparent 1px border). Never change border width.
- Keep the file's static `colors`/`StyleSheet` idiom.
- **Mobile:** `npm test`; `npx tsc --noEmit` (baseline 0); **`npx eslint <files>` before commit** (CI lints).

---

### Task 1: Post-scroll highlight in the workspace

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx` (extend)

**Interfaces:** internal only — a `highlight` state + `flash(key)` helper wired into the existing `onNextAction`.

- [ ] **Step 1: Add the failing tests**

Extend `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx`. Add `import { colors } from "@/constants/theme";` (top). Add a describe block using fake timers scoped to just these tests (so the file's existing real-timer tests are undisturbed):
```tsx
describe("post-scroll highlight", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

  const borderOf = (el: any) => {
    const s = Array.isArray(el.props.style) ? Object.assign({}, ...el.props.style.filter(Boolean)) : el.props.style;
    return s?.borderColor;
  };

  it("Capture next-step highlights the Sources section, then clears", () => {
    (useTrustProject as jest.Mock).mockReturnValue(proj("owner", [], []));   // no inputs → Capture current
    render(<TrustProjectDetail />);
    fireEvent.press(screen.getByLabelText(/Go to next step/i));
    expect(borderOf(screen.getByTestId("journey-anchor-sources"))).toBe(colors.primary);
    act(() => jest.advanceTimersByTime(1500));
    expect(borderOf(screen.getByTestId("journey-anchor-sources"))).not.toBe(colors.primary);
  });

  it("Create next-step highlights the Artifacts section", () => {
    (useTrustProject as jest.Mock).mockReturnValue(proj("owner", [{ id: "i" }], []));  // source + artifact-no-version → Create current
    render(<TrustProjectDetail />);
    fireEvent.press(screen.getByLabelText(/Go to next step/i));
    expect(borderOf(screen.getByTestId("journey-anchor-artifacts"))).toBe(colors.primary);
  });
});
```
Add `act` to the `@testing-library/react-native` import.
(The existing scroll/push and create_artifact-no-push tests stay as-is, outside this describe, on real timers.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx`
Expected: FAIL — no `testID="journey-anchor-*"` / no highlight applied.

- [ ] **Step 3: Implement**

In `mobile/app/trust/[projectId].tsx`:
- Import: add `useEffect` to the react import (`import { useEffect, useRef, useState } from "react";`).
- After the existing refs (`ownerActionsY`), add:
```tsx
  const [highlight, setHighlight] = useState<"sources" | "artifacts" | "owner" | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (key: "sources" | "artifacts" | "owner") => {
    setHighlight(key);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1500);
  };
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);
```
- In `onNextAction`, add a `flash(...)` next to each `scrollTo` (Share/default keeps no highlight):
```tsx
      case "capture":
        scrollTo(sourcesY.current); flash("sources");
        break;
      case "create":
        scrollTo(artifactsY.current); flash("artifacts");
        break;
      case "create_artifact":
        scrollTo(ownerActionsY.current); flash("owner");
        break;
      case "validate":
        scrollTo(isOwner ? ownerActionsY.current : artifactsY.current); flash(isOwner ? "owner" : "artifacts");
        break;
      default:
        router.push("/posts"); // share — no highlight
        break;
```
- The three anchors — add `testID` + the conditional highlight, keeping their existing `onLayout`:
  - `styles.sourcesBlock` view (currently `<View style={styles.sourcesBlock} onLayout=...>`):
    `<View testID="journey-anchor-sources" style={[styles.sourcesBlock, highlight === "sources" && styles.highlighted]} onLayout={...}>`
  - artifacts wrapper (currently `<View onLayout={(e) => { artifactsY.current = ... }}>`):
    `<View testID="journey-anchor-artifacts" style={[styles.artifactsWrap, highlight === "artifacts" && styles.highlighted]} onLayout={...}>`
  - `styles.ownerBlock` view:
    `<View testID="journey-anchor-owner" style={[styles.ownerBlock, highlight === "owner" && styles.highlighted]} onLayout={...}>`
- Add styles:
```tsx
  artifactsWrap: { borderWidth: 1, borderColor: "transparent", borderRadius: radius.md },
  highlighted: { borderColor: colors.primary },
```

- [ ] **Step 4: Run new + all existing detail tests + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/screens/TrustProjectDetail.sources.test.tsx __tests__/screens/TrustProjectDetail.generate.test.tsx && npx tsc --noEmit && npx eslint "app/trust/[projectId].tsx" __tests__/screens/TrustProjectDetail.journey.test.tsx`
Expected: all pass (the fake-timer describe is isolated; existing tests use real timers). 0 type errors, eslint clean.

- [ ] **Step 5: Full suite + commit**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: full suite green.
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx
git commit -m "feat(trust): post-scroll highlight of the Journey target section (ADR-037 Phase B slice 4)"
```

---

## Final verification (after the task)
`cd mobile && npm test && npx tsc --noEmit && npx eslint "app/trust/[projectId].tsx"`
Expected: full suite green, 0 type errors, eslint clean.

Device/web re-verify (JS-only): tap a Journey next-step → the screen scrolls AND the target section's border briefly turns primary, then reverts.

## Self-Review notes (author)
- **Spec coverage:** highlight state + timer + `onNextAction` flash + the three testID'd anchors with the border-swap = the whole Task.
- **No layout shift:** `highlighted` changes only `borderColor`; the two bordered sections keep `borderWidth: 1`; the artifacts wrapper gets a permanent 1px transparent border (`artifactsWrap`) so its color swap also doesn't shift.
- **Test isolation:** fake timers are scoped to the new `describe` (beforeEach/afterEach toggling) so the file's existing real-timer scroll/push tests are unaffected; `borderOf` flattens the style array to read `borderColor`.
- **Cleanup:** the `useEffect` clears the pending timer on unmount (no dangling setState-after-unmount).
- **Risk:** if a section's style array ordering makes `borderColor` from the base win over `highlighted`, the flatten-and-assign in the test would catch it — the conditional style is appended AFTER the base so it overrides correctly.
