# Trust Journey Handhold (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `TrustJourney` 4-phase stepper (Capture → Create → Validate → Share) in the project workspace that shows the owner/reviewer where they are + the next step, plus a first-run tour fork to "Start a project". All derived from existing data — no backend change.

**Architecture:** A pure presentational `TrustJourney` component derives phase state from the `ProjectDetailView` (`inputs`, `artifacts[].versions[].is_validated`) and renders a stepper + a role-aware next-step line. Wired into `app/trust/[projectId].tsx` above the Sources block. The first-run `TourStep` final page branches on `IS_DEMO` to offer "Start a project" (→ `/trust/new`) in real builds.

**Tech Stack:** React Native + Expo, TypeScript, Jest/RNTL. Mobile only.

## Global Constraints
- **No backend change, no new API.** Phase state derives from the existing `useTrustProject().project` (`ProjectDetailView`).
- **Keep the workspace's static `colors`/`StyleSheet` idiom** — do NOT theme-migrate `[projectId].tsx` or use `useThemedStyles`.
- **House style / honesty:** never claim "expert-validated" until a version `is_validated` (the Validate next-step must not imply validation; the Share line appears only once validated). Verbs of craft.
- **Demo-safe:** the tour fork's "Start a project" only shows in real builds (`!IS_DEMO`); demo keeps "Open my Library".
- **Mobile:** `npm test`; `npx tsc --noEmit` (baseline 0); **`npx eslint <files>` before each commit** (CI lints — named components only, no unused imports).
- **Help DoD:** prefer extending an existing topic (no new FEATURES key → no coverage churn).

---

### Task 1: `TrustJourney` component

**Files:**
- Create: `mobile/src/components/TrustJourney.tsx`
- Test: `mobile/__tests__/components/TrustJourney.test.tsx`

**Interfaces:**
- Consumes: `ProjectDetailView` (`@/api/trustClient`), theme tokens.
- Produces: `TrustJourney({ detail, isOwner }: { detail: ProjectDetailView; isOwner: boolean }): React.JSX.Element`.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/components/TrustJourney.test.tsx`:
```tsx
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { TrustJourney } from "@/components/TrustJourney";

function detail(over: Partial<any> = {}) {
  return {
    project: { id: "p1", title: "P", topic: null },
    my_role: "owner",
    artifacts: [],
    inputs: [],
    ...over,
  } as any;
}
const withVersion = (is_validated = false) => ({
  artifacts: [{ artifact: { id: "a", title: "G", role: "cornerstone", format: "guide" },
                versions: [{ id: "v", version_no: 1, is_validated, recorded_via: null }] }],
});

it("shows all four phase labels", () => {
  render(<TrustJourney detail={detail()} isOwner />);
  for (const p of ["Capture", "Create", "Validate", "Share"]) expect(screen.getByText(p)).toBeTruthy();
});

it("no sources → Capture is current with the add-a-source next step (owner)", () => {
  render(<TrustJourney detail={detail()} isOwner />);
  expect(screen.getByText(/add a source/i)).toBeTruthy();
});

it("sources but no version → Create current (generate a draft)", () => {
  render(<TrustJourney detail={detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }] })} isOwner />);
  expect(screen.getByText(/generate a draft/i)).toBeTruthy();
});

it("a version, none validated → Validate current; owner invites, reviewer reviews", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }], ...withVersion(false) });
  const { rerender } = render(<TrustJourney detail={{ ...d, my_role: "owner" }} isOwner />);
  expect(screen.getByText(/invite an expert/i)).toBeTruthy();
  rerender(<TrustJourney detail={{ ...d, my_role: "reviewer" }} isOwner={false} />);
  expect(screen.getByText(/review the latest version/i)).toBeTruthy();
});

it("a validated version → Share step (both roles), never claims validation early", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }], ...withVersion(true) });
  render(<TrustJourney detail={d} isOwner />);
  expect(screen.getByText(/Posts tab/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npm test -- __tests__/components/TrustJourney.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

`mobile/src/components/TrustJourney.tsx`:
```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ProjectDetailView } from "@/api/trustClient";
import { colors, radius, spacing, typography } from "@/constants/theme";

type Phase = { key: string; label: string; done: boolean };

// The next-step line for the CURRENT phase, by role. Never implies validation
// before a version is actually approved (Share copy appears only at that point).
function nextStep(currentKey: string, isOwner: boolean): string {
  switch (currentKey) {
    case "capture":
      return isOwner
        ? "Next: add a source — paste a transcript, note, or link below."
        : "The owner is still capturing sources.";
    case "create":
      return isOwner
        ? "Next: generate a draft from your sources below."
        : "Waiting for the owner to generate a draft.";
    case "validate":
      return isOwner
        ? "Next: invite an expert to review — they approve a version below."
        : "Your turn: review the latest version and approve it below.";
    default: // share
      return "This project has an expert-validated version. Share it from the Posts tab.";
  }
}

export function TrustJourney({ detail, isOwner }: { detail: ProjectDetailView; isOwner: boolean }): React.JSX.Element {
  const captured = (detail.inputs?.length ?? 0) > 0;
  const created = detail.artifacts.some((a) => a.versions.length > 0);
  const validated = detail.artifacts.some((a) => a.versions.some((v) => v.is_validated));
  const phases: Phase[] = [
    { key: "capture", label: "Capture", done: captured },
    { key: "create", label: "Create", done: created },
    { key: "validate", label: "Validate", done: validated },
    { key: "share", label: "Share", done: false }, // Share is the goal, actioned on the Posts tab
  ];
  // First not-done phase is "current". Share is never done, so this is always ≥0.
  const currentIdx = phases.findIndex((p) => !p.done);

  return (
    <View style={styles.wrap} accessibilityLabel="Project journey">
      <View style={styles.row}>
        {phases.map((p, i) => {
          const state = p.done ? "done" : i === currentIdx ? "current" : "upcoming";
          const glyph = state === "done" ? "✓" : state === "current" ? "●" : "○";
          return (
            <View key={p.key} style={styles.phase} accessibilityLabel={`${p.label}: ${state}`}>
              <Text style={[styles.glyph, state === "current" && styles.glyphCurrent, state === "done" && styles.glyphDone]}>
                {glyph}
              </Text>
              <Text style={[styles.label, state === "current" && styles.labelCurrent]}>{p.label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.next}>{nextStep(phases[currentIdx].key, isOwner)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between" },
  phase: { alignItems: "center", flex: 1, gap: 2 },
  glyph: { fontSize: typography.sizeMd, color: colors.textMuted },
  glyphCurrent: { color: colors.primary, fontWeight: "700" },
  glyphDone: { color: colors.growth },
  label: { fontSize: typography.sizeXs, color: colors.textSecondary },
  labelCurrent: { color: colors.text, fontWeight: "700" },
  next: { fontSize: typography.sizeSm, color: colors.text, lineHeight: 20 },
});
```
**Token check:** `colors.surface/border/textMuted/primary/growth/textSecondary/text`, `radius.md`, `spacing.md/sm`, `typography.sizeMd/sizeXs/sizeSm` — all exist in `theme.ts` (verified). tsc catches any typo.

- [ ] **Step 4: Run test + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/components/TrustJourney.test.tsx && npx tsc --noEmit && npx eslint src/components/TrustJourney.tsx __tests__/components/TrustJourney.test.tsx`
Expected: PASS (5 tests) + 0 type errors + eslint clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/TrustJourney.tsx mobile/__tests__/components/TrustJourney.test.tsx
git commit -m "feat(trust): TrustJourney phase-stepper component (ADR-037 Phase B)"
```

---

### Task 2: Wire the Journey into the workspace

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx`

**Notes:** READ `mobile/app/trust/[projectId].tsx` — render `<TrustJourney detail={project} isOwner={isOwner} />` immediately after the `<Text style={styles.title}>` / topic lines and before the `styles.sourcesBlock` view. `project` is the `ProjectDetailView` from `useTrustProject`; `isOwner` already exists. Import `TrustJourney` from `@/components/TrustJourney`. No other change.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx` — mirror `TrustProjectDetail.owner.test.tsx`'s mock harness (`jest.mock("@/hooks/useTrustProject")`, expo-router, `@/lib/alert`). Mock an owner project with no inputs/versions; render the route; assert the four phase labels ("Capture", "Create", "Validate", "Share") are present AND the "Project journey" container renders above the Sources block. (Include `inputs: []` in the mocked return to be explicit.)

- [ ] **Step 2: Run → FAIL** (no Journey yet).

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx`

- [ ] **Step 3: Wire it in**

Add the import + render `<TrustJourney detail={project} isOwner={isOwner} />` after the title/topic, before `styles.sourcesBlock`.

- [ ] **Step 4: Run new + existing detail tests + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/screens/TrustProjectDetail.sources.test.tsx __tests__/screens/TrustProjectDetail.generate.test.tsx && npx tsc --noEmit && npx eslint "app/trust/[projectId].tsx" __tests__/screens/TrustProjectDetail.journey.test.tsx`
Expected: all pass (existing detail tests unaffected — they mock projects without inputs, Journey defaults to Capture-current, renders fine), 0 type errors, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx
git commit -m "feat(trust): render the Journey stepper in the project workspace (ADR-037 Phase B)"
```

---

### Task 3: First-run tour fork to authoring

**Files:**
- Modify: `mobile/src/onboarding/steps/TourStep.tsx`
- Test: `mobile/__tests__/onboarding/TourStep.test.tsx` (new) + `mobile/__tests__/onboarding/TourStep.demo.test.tsx` (new, demo case)
- **Modify: `mobile/__tests__/onboarding/FirstRunWizard.test.tsx`** — ⚠ line ~99 currently `fireEvent.press(screen.getByLabelText("Open my Library"))` → expects `/library`. Jest's default is `IS_DEMO === false` (no `EXPO_PUBLIC_DEMO_MODE`), so after this task the coordinator's tour final page shows **"Start a project"**, not "Open my Library" — this test WILL break. Update that assertion to the new non-demo fork: press **"Start a project"** → expect `mockPush` called with `"/trust/new"` (the coordinator still completes via `onDone`). Do NOT change the rest of the FirstRunWizard test.

**Notes:** READ `mobile/src/onboarding/steps/TourStep.tsx` (2 pages; final page CTA "Open my Library" → `/library`) + `WizardScaffold` (primary + skip). The final page must branch on `IS_DEMO` (`@/constants/demo`). Keep the `openLibrary` handler (`onDone()` then `router.push("/library")`).

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/onboarding/TourStep.test.tsx`:
```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/constants/demo", () => ({ IS_DEMO: false }));
import { TourStep } from "@/onboarding/steps/TourStep";

const props = { stepIndex: 2, stepCount: 3, onDone: jest.fn(), onSkip: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it("real build: final page offers Start a project → /trust/new", () => {
  render(<TourStep {...props} />);
  fireEvent.press(screen.getByText("Next"));            // page 0 → 1
  fireEvent.press(screen.getByText("Start a project"));
  expect(props.onDone).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/trust/new");
});
```
Add a second test file variant OR use `jest.isolateModules`/`jest.doMock` for the demo case; simplest: a second test that re-mocks `@/constants/demo` to `{ IS_DEMO: true }` in its own file (`TourStep.demo.test.tsx`) asserting the final page shows "Open my Library" and routes to `/library`. (Per-file module mock is the clean way to flip `IS_DEMO`.)

- [ ] **Step 2: Run → FAIL** ("Start a project" not present).

Run: `cd mobile && npm test -- __tests__/onboarding/TourStep.test.tsx`

- [ ] **Step 3: Implement the fork**

In `TourStep.tsx`: `import { IS_DEMO } from "@/constants/demo";` and add `const startProject = () => { onDone(); router.push("/trust/new"); };`. On the final page (`page === 1`), when `!IS_DEMO` render a fork WizardScaffold: title "What would you like to do?", body two short lines (Create / Read), `primaryLabel="Start a project"` `onPrimary={startProject}`, `skipLabel="Just read for now"` `onSkip={openLibrary}`. When `IS_DEMO`, keep the existing "Open my Library" page unchanged.

- [ ] **Step 4: Run tests + the existing FirstRunWizard test + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/onboarding/ && npx tsc --noEmit && npx eslint src/onboarding/steps/TourStep.tsx __tests__/onboarding/TourStep.test.tsx`
Expected: new TourStep tests pass AND the updated `FirstRunWizard.test.tsx` passes (its line-99 assertion now presses "Start a project" → `/trust/new`). 0 type errors, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/onboarding/steps/TourStep.tsx mobile/__tests__/onboarding/TourStep.test.tsx mobile/__tests__/onboarding/TourStep.demo.test.tsx mobile/__tests__/onboarding/FirstRunWizard.test.tsx
git commit -m "feat(trust): first-run tour fork to Start a project (ADR-037 Phase B)"
```

---

### Task 4: Help + full-suite / DoD

**Files:**
- Modify: `mobile/src/help-content/topics.ts` (extend the `projects` topic, `topics.ts:453`)

**Notes:** extend the existing `projects` topic (`featureKey: "projects"`) with a short paragraph on the **four phases** (Capture → Create → Validate → Share) and that the workspace shows where you are + the next step. No new FEATURES key.

- [ ] **Step 1: Extend the `projects` topic** with a four-phase paragraph (house style; "capture → create → validate → share"; the workspace guides you).

- [ ] **Step 2: Run coverage + full suite + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts && npm test && npx tsc --noEmit && npx eslint src/help-content/topics.ts`
Expected: coverage PASS (no new key); full suite green; tsc 0; eslint clean.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/help-content/topics.ts
git commit -m "feat(trust): Help — the four-phase project journey (ADR-037 Phase B DoD)"
```

---

## Final verification (after all tasks)
`cd mobile && npm test && npx tsc --noEmit && npx eslint src/components/TrustJourney.tsx "app/trust/[projectId].tsx" src/onboarding/steps/TourStep.tsx`
Expected: full suite green, 0 type errors, eslint clean.

Optional device/web re-verify (JS-only → Metro reload): open a project → the Journey stepper shows the current phase + next step; add a source → Capture ✓ and it advances to Create; run the tour → "Start a project" routes to New Project.

## Self-Review notes (author)
- **Spec coverage:** `TrustJourney` (derive + render + role-aware next-step) = Task 1; workspace wiring = Task 2; first-run fork = Task 3; Help = Task 4.
- **Derivation correctness:** Capture=inputs>0, Create=any version, Validate=any is_validated, Share=goal (never done → current lands on Share once validated). `phases.findIndex(!done)` is always ≥0 because Share.done=false.
- **Honesty:** the Validate next-step never claims validation; the Share line ("expert-validated version") only renders when a version `is_validated` (current=Share). Matches ADR-037's recorded_via discipline.
- **No regressions:** existing detail tests mock projects without `inputs` → `detail.inputs?.length ?? 0` = 0 → Journey renders Capture-current, no crash. Task 2 Step 4 runs all detail tests to confirm.
- **Deviation guard:** workspace NOT theme-migrated (static colors kept). Tour fork demo-gated. No backend/API change.
- **Risk flagged:** Task 3 — flipping `IS_DEMO` per test needs per-file module mocks (two test files); noted. `FirstRunWizard.test.tsx` may assert the old terminal copy — Task 3 Step 4 re-runs it.
