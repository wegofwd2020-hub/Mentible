# Trust Journey — Phase Accuracy (Phase B slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `TrustJourney` guidance correct in every state — split Create into "add an artifact" vs "generate a draft", and stop reading "ready to share" while any artifact still holds an unvalidated/empty draft.

**Architecture:** Refine `TrustJourney`'s derived state (`hasArtifact`, `anyVersion`, `.every`-based `allValidated`) + a `create_artifact` sub-key for the no-artifact case; the workspace `onNextAction` gains a `create_artifact` → Add-artifact scroll target. Pure derivation; no backend.

**Tech Stack:** React Native + Expo, TypeScript, Jest/RNTL. Mobile only.

## Global Constraints
- Pure component logic — no backend, no new API, no Help/FEATURES change.
- Keep the workspace static `colors`/`StyleSheet` idiom.
- **One existing test changes semantics:** `TrustJourney.test.tsx`'s "sources but no version → Create current (generate a draft)" used a fixture with `inputs` set but `artifacts: []` — under the new logic that is now **"add an artifact"** (no artifact yet). Task 1 updates that assertion + adds a separate artifact-with-no-versions case for "generate a draft". Do NOT leave the old assertion.
- **Mobile:** `npm test`; `npx tsc --noEmit` (baseline 0); **`npx eslint <files>` before each commit** (CI lints).

---

### Task 1: `TrustJourney` — Create sub-step + `.every` share-readiness

**Files:**
- Modify: `mobile/src/components/TrustJourney.tsx`
- Test: `mobile/__tests__/components/TrustJourney.test.tsx` (update + extend)

**Interfaces:**
- Unchanged public signature (`{ detail, isOwner, onNext? }`). New internal phase keys: `onNext` may now be called with `"create_artifact"` (Task 2 handles it).

- [ ] **Step 1: Update + add tests**

In `mobile/__tests__/components/TrustJourney.test.tsx`:
- **Replace** the existing test `"sources but no version → Create current (generate a draft)"` — with sources set but no artifact, the copy is now **"add an artifact"**:
```tsx
it("sources but no artifact → Create current with the add-an-artifact next step (owner)", () => {
  render(<TrustJourney detail={detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }] })} isOwner />);
  expect(screen.getByText(/add an artifact/i)).toBeTruthy();
});
```
- **Add** (artifact present, no version → "generate a draft"):
```tsx
const emptyArtifact = () => ({ artifacts: [{ artifact: { id: "a", title: "G", role: "cornerstone", format: "guide" }, versions: [] }] });

it("sources + an artifact with no version → Create current, generate-a-draft", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }], ...emptyArtifact() });
  render(<TrustJourney detail={d} isOwner />);
  expect(screen.getByText(/generate a draft/i)).toBeTruthy();
});

it("onNext reports create_artifact when there is no artifact, create when there is one", () => {
  const base = { inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }] };
  const onNext = jest.fn();
  const { rerender } = render(<TrustJourney detail={detail(base)} isOwner onNext={onNext} />);
  fireEvent.press(screen.getByLabelText(/Go to next step/i));
  expect(onNext).toHaveBeenLastCalledWith("create_artifact");
  rerender(<TrustJourney detail={detail({ ...base, ...emptyArtifact() })} isOwner onNext={onNext} />);
  fireEvent.press(screen.getByLabelText(/Go to next step/i));
  expect(onNext).toHaveBeenLastCalledWith("create");
});
```
- **Add** share-readiness (`.every`) tests:
```tsx
const artifact = (id: string, is_validated: boolean | null) => ({
  artifact: { id, title: id, role: "cornerstone", format: "guide" },
  versions: is_validated === null ? [] : [{ id: id + "v", version_no: 1, is_validated, recorded_via: null }],
});

it("one validated + a second artifact with an unvalidated draft → still Validate, not Share", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }],
    artifacts: [artifact("A", true), artifact("B", false)] });
  render(<TrustJourney detail={d} isOwner />);
  expect(screen.getByText(/invite an expert|review the latest/i)).toBeTruthy(); // Validate copy
  expect(screen.queryByText(/Posts tab/i)).toBeNull();                          // not Share
});

it("one validated + a second EMPTY artifact → still Validate, not Share", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }],
    artifacts: [artifact("A", true), artifact("B", null)] });
  render(<TrustJourney detail={d} isOwner />);
  expect(screen.queryByText(/Posts tab/i)).toBeNull();
});

it("a single validated artifact → Share current (happy path)", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }],
    artifacts: [artifact("A", true)] });
  render(<TrustJourney detail={d} isOwner />);
  expect(screen.getByText(/Posts tab/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify the new/updated ones fail**

Run: `cd mobile && npm test -- __tests__/components/TrustJourney.test.tsx`
Expected: the new/updated tests FAIL (old logic: no artifact still says "generate a draft"; `.some` makes A+B read Share).

- [ ] **Step 3: Implement**

In `mobile/src/components/TrustJourney.tsx`:
- Add a `nextStep` arm for `create_artifact` and keep `create`:
```tsx
    case "create_artifact":
      return isOwner
        ? "Next: add an artifact to hold your draft."
        : "Waiting for the owner to create a draft.";
    case "create":
      return isOwner
        ? "Next: generate a draft from your sources below."
        : "Waiting for the owner to create a draft.";
```
- Replace the derivation block:
```tsx
  const captured = (detail.inputs?.length ?? 0) > 0;
  const hasArtifact = detail.artifacts.length > 0;
  const anyVersion = detail.artifacts.some((a) => a.versions.length > 0);
  // Every artifact must have a validated version (≥1 artifact) — an artifact with
  // only unvalidated drafts, or a fresh empty artifact, keeps the project in
  // Validate rather than reading "ready to share".
  const allValidated = hasArtifact && detail.artifacts.every((a) => a.versions.some((v) => v.is_validated));
  const phases: Phase[] = [
    { key: "capture", label: "Capture", done: captured },
    { key: "create", label: "Create", done: anyVersion },
    { key: "validate", label: "Validate", done: allValidated },
    { key: "share", label: "Share", done: false },
  ];
  const currentIdx = phases.findIndex((p) => !p.done);
  // In the Create phase, distinguish "no artifact yet" (add one) from "artifact,
  // no draft" (generate) so the tap targets the control that actually exists.
  const currentKey =
    phases[currentIdx].key === "create" && !hasArtifact ? "create_artifact" : phases[currentIdx].key;
  const nextText = nextStep(currentKey, isOwner);
```
(The render already uses `currentKey` for the `Pressable`'s `onNext(currentKey)` and `nextText` for the label — no render change needed.)

- [ ] **Step 4: Run test + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/components/TrustJourney.test.tsx && npx tsc --noEmit && npx eslint src/components/TrustJourney.tsx __tests__/components/TrustJourney.test.tsx`
Expected: all TrustJourney tests pass + 0 type errors + eslint clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/TrustJourney.tsx mobile/__tests__/components/TrustJourney.test.tsx
git commit -m "feat(trust): Journey Create sub-step + every-artifact share readiness (ADR-037 Phase B slice 3)"
```

---

### Task 2: Workspace — `create_artifact` scroll target

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx` (extend)

**Notes:** READ the existing `onNextAction` switch in `app/trust/[projectId].tsx` (cases: capture→sourcesY, create→artifactsY, validate→…, default(share)→push). Add the `create_artifact` case scrolling to `ownerActionsY` (the "Add an artifact" control).

- [ ] **Step 1: Add the failing test**

Extend `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx`: a captured-but-no-artifact owner project (`inputs: [one]`, `artifacts: []`) → the Journey next-step is the "add an artifact" button; pressing it does NOT throw and does NOT call `mockPush` (it's a scroll, not a route). (The share→`push("/posts")` test already exists.)

- [ ] **Step 2: Run → confirm it exercises the path (may pass trivially if no throw)**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx`
Note: pressing already won't throw even before the case is added (the `switch` has no `create_artifact` case → falls to `default` → `router.push("/posts")` — which WOULD call mockPush, wrongly). So the test **should fail** because before the fix, `create_artifact` hits the `default` and calls `push("/posts")`. Confirm that failure (asserts `mockPush` NOT called).

- [ ] **Step 3: Implement**

In `onNextAction`, add before the `default`:
```tsx
      case "create_artifact":
        scrollTo(ownerActionsY.current);
        break;
```

- [ ] **Step 4: Run new + all existing detail tests + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.journey.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/screens/TrustProjectDetail.sources.test.tsx __tests__/screens/TrustProjectDetail.generate.test.tsx && npx tsc --noEmit && npx eslint "app/trust/[projectId].tsx" __tests__/screens/TrustProjectDetail.journey.test.tsx`
Expected: all pass (the `create_artifact` press now scrolls, no `push`). 0 type errors, eslint clean.

- [ ] **Step 5: Full suite + commit**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: full suite green.
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx
git commit -m "feat(trust): scroll to Add-artifact for the create_artifact step (ADR-037 Phase B slice 3)"
```

---

## Final verification (after all tasks)
`cd mobile && npm test && npx tsc --noEmit && npx eslint src/components/TrustJourney.tsx "app/trust/[projectId].tsx"`
Expected: full suite green, 0 type errors, eslint clean.

Device/web re-verify (JS-only): a fresh project with a source but no artifact → Journey says "add an artifact" and the tap scrolls to Add-artifact; add an artifact → it flips to "generate a draft"; a project with one validated + one drafted artifact → still shows Validate, not "share".

## Self-Review notes (author)
- **Spec coverage:** Create sub-step (`create_artifact` key + `nextStep` arm + `currentKey` resolution) + `.every` `allValidated` = Task 1; the `create_artifact` scroll target = Task 2.
- **Breaking-test handled:** Task 1 Step 1 explicitly replaces the now-wrong "sources → generate a draft" assertion (no artifact ⇒ add-an-artifact) and adds the artifact-present variant.
- **`.every` correctness:** `allValidated = hasArtifact && artifacts.every(a => a.versions.some(is_validated))` — guards the empty-array `.every === true` trap via `hasArtifact`; an empty or unvalidated-draft artifact makes `.some` false → `every` false → not done (stays Validate). Single validated artifact → done → Share. Verified in the tests.
- **Type/behavior consistency:** `create_artifact` emitted by `onNext` (Task 1) is consumed by `onNextAction` (Task 2); before Task 2 it would fall through to `default`→push, which is exactly what Task 2's test catches then fixes.
- **Risk:** the reviewer-side Create copy collapses `create`/`create_artifact` to the same "Waiting for the owner to create a draft." line — intentional (reviewers don't act in Create); noted.
