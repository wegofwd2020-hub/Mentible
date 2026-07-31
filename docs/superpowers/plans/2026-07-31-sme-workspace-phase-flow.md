# SME Workspace Phase-Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `trust/[projectId]` into a guided, phase-tabbed workspace — a merged phase/tab bar (current phase auto-selected) over four role-adaptive panels — so the next action is always obvious (the wayfinding fix).

**Architecture:** Extract the phase-derivation logic out of `TrustJourney` into a pure `deriveProjectPhase` helper. A new `PhaseTabBar` (the merged stepper+tabs) drives which of four panels (Sources/Drafts/Feedback/Publish) renders. The screen reuses every existing `useTrustProject` action; `TrustJourney` and the old scroll+flash are removed. UI-only — no backend/data change.

**Tech Stack:** React Native + Expo, `useThemedStyles`/`SmeThemeScope` (Navy Trust — ADR-038), Jest + RN Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-31-sme-workspace-phase-flow-design.md`

## Global Constraints

- **UI-only.** No change to `useTrustProject`, `trustClient`, or any backend. Reuse the existing actions (`addInput`, `addArtifact`, `generateVersion`, `approve`, `invite`) and their busy-state + `@/lib/alert` error handling verbatim.
- **Navy Trust preserved.** The screen stays wrapped in `SmeThemeScope`; all styles via `useThemedStyles` (never the static `colors`). Fraunces heading token where a real heading (ADR-038).
- **Trust honesty.** Keep the `recorded_via` chips ("expert-validated" / "operator-recorded") on validated versions — never a bare "validated".
- **Role-adaptive.** `isOwner = project.my_role === "owner"`. Owner-only controls (add-source form, invite, add-artifact, generate) never render for a reviewer.
- **No new Help FEATURES key** (flow restructure of an existing surface). Update the trust-workspace Help topic copy if it describes the old scroll layout.
- Commands from `mobile/`: `npx jest <file>`, `npx tsc --noEmit -p tsconfig.json` (baseline 0), `npx eslint <files>` (name any mock components — `react/display-name`).

---

### Task 1: `deriveProjectPhase` pure helper

**Files:**
- Create: `mobile/src/lib/projectPhase.ts`
- Test: `mobile/__tests__/lib/projectPhase.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PhaseKey = "capture" | "create" | "validate" | "share";
  export const PHASE_LABELS: Record<PhaseKey, string>; // capture:"Sources", create:"Drafts", validate:"Feedback", share:"Publish"
  export const PHASE_ORDER: PhaseKey[];                 // ["capture","create","validate","share"]
  export interface ProjectPhase {
    phases: { key: PhaseKey; done: boolean }[];
    currentIdx: number;
    currentKey: PhaseKey | "create_artifact";
  }
  export function deriveProjectPhase(detail: ProjectDetailView, isOwner: boolean): ProjectPhase;
  ```
  (`isOwner` is accepted for parity with `TrustJourney`'s signature and future role-specific tweaks; the current derivation does not branch on it, matching today's logic.)

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/lib/projectPhase.test.ts
import { deriveProjectPhase, PHASE_LABELS } from "@/lib/projectPhase";

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: Partial<any> = {}) =>
  ({ project: { id: "p1", title: "P", topic: null }, my_role: "owner", artifacts: [], inputs: [], ...over }) as any;
const artifact = (id: string, is_validated: boolean | null) => ({
  artifact: { id, title: id, role: "cornerstone", format: "guide" },
  versions: is_validated === null ? [] : [{ id: id + "v", version_no: 1, is_validated, recorded_via: null }],
});

it("labels map phases to content nouns", () => {
  expect(PHASE_LABELS).toEqual({ capture: "Sources", create: "Drafts", validate: "Feedback", share: "Publish" });
});

it("no inputs → capture current", () => {
  const p = deriveProjectPhase(detail(), true);
  expect(p.currentKey).toBe("capture");
  expect(p.phases.find((x) => x.key === "capture")!.done).toBe(false);
});

it("inputs but no artifact → create_artifact", () => {
  expect(deriveProjectPhase(detail({ inputs: [input] }), true).currentKey).toBe("create_artifact");
});

it("inputs + an empty artifact → create", () => {
  expect(deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", null)] }), true).currentKey).toBe("create");
});

it("a version, none validated → validate", () => {
  expect(deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", false)] }), true).currentKey).toBe("validate");
});

it("all artifacts validated → share (capture/create/validate done)", () => {
  const p = deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", true)] }), true);
  expect(p.currentKey).toBe("share");
  expect(p.phases.filter((x) => x.done).map((x) => x.key)).toEqual(["capture", "create", "validate"]);
});

it("one validated + a second unvalidated artifact → still validate, not share", () => {
  expect(deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", true), artifact("B", false)] }), true).currentKey).toBe("validate");
});
```

- [ ] **Step 2: Run it — Expected FAIL** (`Cannot find module '@/lib/projectPhase'`).
Run: `cd mobile && npx jest __tests__/lib/projectPhase.test.ts`

- [ ] **Step 3: Implement** (lift the logic from `TrustJourney.tsx:42-59` verbatim)

```ts
// mobile/src/lib/projectPhase.ts
import type { ProjectDetailView } from "@/api/trustClient";

export type PhaseKey = "capture" | "create" | "validate" | "share";
export const PHASE_ORDER: PhaseKey[] = ["capture", "create", "validate", "share"];
export const PHASE_LABELS: Record<PhaseKey, string> = {
  capture: "Sources",
  create: "Drafts",
  validate: "Feedback",
  share: "Publish",
};

export interface ProjectPhase {
  phases: { key: PhaseKey; done: boolean }[];
  currentIdx: number;
  currentKey: PhaseKey | "create_artifact";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function deriveProjectPhase(detail: ProjectDetailView, isOwner: boolean): ProjectPhase {
  const captured = (detail.inputs?.length ?? 0) > 0;
  const hasArtifact = detail.artifacts.length > 0;
  const anyVersion = detail.artifacts.some((a) => a.versions.length > 0);
  const allValidated = hasArtifact && detail.artifacts.every((a) => a.versions.some((v) => v.is_validated));
  const done: Record<PhaseKey, boolean> = { capture: captured, create: anyVersion, validate: allValidated, share: false };
  const phases = PHASE_ORDER.map((key) => ({ key, done: done[key] }));
  const currentIdx = phases.findIndex((p) => !p.done);
  const base = phases[currentIdx].key;
  const currentKey = base === "create" && !hasArtifact ? "create_artifact" : base;
  return { phases, currentIdx, currentKey };
}
```

- [ ] **Step 4: Run it — Expected PASS.** `cd mobile && npx jest __tests__/lib/projectPhase.test.ts`
- [ ] **Step 5: Commit**
```bash
cd mobile && npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/projectPhase.ts __tests__/lib/projectPhase.test.ts
git add mobile/src/lib/projectPhase.ts mobile/__tests__/lib/projectPhase.test.ts
git commit -m "feat(trust): deriveProjectPhase helper (workspace phase-flow)"
```

---

### Task 2: `PhaseTabBar` — merged stepper + tabs

**Files:**
- Create: `mobile/src/components/PhaseTabBar.tsx`
- Test: `mobile/__tests__/components/PhaseTabBar.test.tsx`

**Interfaces:**
- Consumes: `ProjectPhase`, `PhaseKey`, `PHASE_LABELS` (Task 1).
- Produces: `PhaseTabBar({ phase, selected, onSelect }: { phase: ProjectPhase; selected: PhaseKey; onSelect: (k: PhaseKey) => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/components/PhaseTabBar.test.tsx
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { PhaseTabBar } from "@/components/PhaseTabBar";
import { deriveProjectPhase } from "@/lib/projectPhase";

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: any = {}) => ({ project: { id: "p", title: "P", topic: null }, my_role: "owner", artifacts: [], inputs: [], ...over }) as any;

it("renders a tab per phase with its content-noun label", () => {
  const phase = deriveProjectPhase(detail(), true);
  const { getByText } = render(<PhaseTabBar phase={phase} selected="capture" onSelect={() => {}} />);
  for (const label of ["Sources", "Drafts", "Feedback", "Publish"]) expect(getByText(label)).toBeTruthy();
});

it("marks the selected tab selected and reports taps", () => {
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true);
  const onSelect = jest.fn();
  const { getByLabelText } = render(<PhaseTabBar phase={phase} selected="capture" onSelect={onSelect} />);
  // The selected Sources tab carries selected state.
  expect(getByLabelText(/Sources:/).props.accessibilityState.selected).toBe(true);
  // Tapping Drafts reports it.
  fireEvent.press(getByLabelText(/Drafts:/));
  expect(onSelect).toHaveBeenCalledWith("create");
});

it("shows done/current/upcoming state in the tab label", () => {
  const phase = deriveProjectPhase(detail({ inputs: [input] }), true); // capture done, create current
  const { getByLabelText } = render(<PhaseTabBar phase={phase} selected="create" onSelect={() => {}} />);
  expect(getByLabelText(/Sources: done/)).toBeTruthy();
  expect(getByLabelText(/Drafts: current/)).toBeTruthy();
  expect(getByLabelText(/Feedback: upcoming/)).toBeTruthy();
});
```

- [ ] **Step 2: Run it — Expected FAIL** (module missing).

- [ ] **Step 3: Implement**

```tsx
// mobile/src/components/PhaseTabBar.tsx
import React from "react";
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { PHASE_LABELS, PHASE_ORDER, type PhaseKey, type ProjectPhase } from "@/lib/projectPhase";

export function PhaseTabBar({
  phase, selected, onSelect,
}: { phase: ProjectPhase; selected: PhaseKey; onSelect: (k: PhaseKey) => void }): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const currentKey = PHASE_ORDER[phase.currentIdx];
  return (
    <View style={styles.bar} accessibilityLabel="Project phases">
      {phase.phases.map((p) => {
        const state = p.done ? "done" : p.key === currentKey ? "current" : "upcoming";
        const glyph = state === "done" ? "✓" : state === "current" ? "●" : "○";
        const active = p.key === selected;
        return (
          <Pressable
            key={p.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${PHASE_LABELS[p.key]}: ${state}`}
            onPress={() => onSelect(p.key)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.glyph, state === "current" && styles.glyphCurrent, state === "done" && styles.glyphDone]}>{glyph}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{PHASE_LABELS[p.key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  bar: { flexDirection: "row" as const, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: "center" as const, paddingVertical: spacing.sm, borderRadius: radius.sm, gap: 2 },
  tabActive: { backgroundColor: c.surfaceHigh },
  glyph: { fontSize: typography.sizeMd, color: c.textMuted },
  glyphCurrent: { color: c.primary, fontWeight: "700" as const },
  glyphDone: { color: c.growth },
  label: { fontSize: typography.sizeXs, color: c.textSecondary },
  labelActive: { color: c.text, fontWeight: "700" as const },
});
```

- [ ] **Step 4: Run it — Expected PASS.**
- [ ] **Step 5: Commit**
```bash
cd mobile && npx tsc --noEmit -p tsconfig.json && npx eslint src/components/PhaseTabBar.tsx __tests__/components/PhaseTabBar.test.tsx
git add mobile/src/components/PhaseTabBar.tsx mobile/__tests__/components/PhaseTabBar.test.tsx
git commit -m "feat(trust): PhaseTabBar merged stepper+tabs (workspace phase-flow)"
```

---

### Task 3: Restructure `trust/[projectId]` into the tabbed workspace

**Files:**
- Modify (rewrite): `mobile/app/trust/[projectId].tsx`
- Delete: `mobile/src/components/TrustJourney.tsx`, `mobile/__tests__/components/TrustJourney.test.tsx` (only consumer is this screen — grep-confirmed)
- Modify/rewrite: `mobile/__tests__/screens/TrustProjectDetail.journey.test.tsx` (its scroll+flash behavior is gone), and update `TrustProjectDetail.test.tsx` / `TrustProjectDetail.owner.test.tsx` where they assumed the one-scroll layout
- Modify (if it describes the old layout): the `make-a-...`/trust-workspace Help topic in `mobile/src/help-content/topics.ts`

**Interfaces:**
- Consumes: `deriveProjectPhase` + `PHASE_ORDER`/`PhaseKey` (Task 1), `PhaseTabBar` (Task 2), the existing `useTrustProject` actions.

**Transformation (the screen already exists — this restructures it):**
1. Replace `<TrustJourney … onNext=…>` + the three sibling blocks with `<PhaseTabBar …>` + a single selected panel. Remove `scrollRef`/`sourcesY`/`artifactsY`/`ownerActionsY`, the `highlight` state, `highlightTimer`, `flash`, and `onNextAction` entirely.
2. Add selection state seeded from the current phase:
   ```tsx
   const phase = deriveProjectPhase(project, isOwner);
   const basePhase = (k: typeof phase.currentKey): PhaseKey => (k === "create_artifact" ? "create" : k);
   const [selected, setSelected] = useState<PhaseKey | null>(null);
   const active = selected ?? basePhase(phase.currentKey); // auto-select current until the user taps a tab
   ```
   (Compute `phase` only when `project` is loaded — keep the existing `loading`/`error`/`!project` early returns above this.)
3. Render:
   ```tsx
   <PhaseTabBar phase={phase} selected={active} onSelect={setSelected} />
   {active === "capture"  && <SourcesPanel  ... />}
   {active === "create"   && <DraftsPanel   ... />}
   {active === "validate" && <FeedbackPanel ... />}
   {active === "share"    && <PublishPanel />}
   ```
4. **Panels** — move the existing block JSX into four local components in this file (extract to `mobile/src/components/trust/` only if the file gets unwieldy — plan open item). Each takes the data + the handlers it needs; keep every existing action, busy-state var, `Alert` call, `accessibilityLabel`, and `recorded_via` chip **unchanged**:
   - **`SourcesPanel`** = today's `sourcesBlock` (owner: the `SOURCE_KINDS` picker + title/content inputs + `onAddSource` → `addInput`; the input list). Reviewer: list only.
   - **`DraftsPanel`** = today's `artifactsWrap` (artifacts → versions; owner `onGenerateDraft` → `generateVersion`, plus the "Add an artifact" control here when there are no artifacts — moved from the owner block). Approve buttons **move to FeedbackPanel** (see below); Drafts shows version rows read-only-ish with the validated/`recorded_via` state.
   - **`FeedbackPanel`** = the **Approve** flow (`onApprove` → `approve`, the `Alert.alert` confirm) for unvalidated versions + the validated/`recorded_via` display, AND (owner) the **Invite an expert** control (`onInvite` → `invite`) moved from the owner block.
   - **`PublishPanel`** = a placeholder: one line, e.g. `"Sharing & export are coming soon."` (Publish tab deferred — user decision). No CTA.
   - A panel whose phase isn't reachable yet shows a short "…finish _<prev>_ first" note in place of actions (reuse the existing `emptyText` style).
5. Keep the outer `<SmeThemeScope>` + `useThemedStyles` + the Fraunces `title`. Reassign the existing style keys to the panels (no visual regression within a panel).

- [ ] **Step 1: Write/adjust the failing screen tests**

Rewrite `TrustProjectDetail.journey.test.tsx` to assert tab-flow instead of scroll+flash. Example cases (mock `useTrustProject` as the existing tests do):

```tsx
it("auto-selects the current phase on load (no sources → Sources)", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  render(<TrustProjectDetail />);
  // Sources tab is selected, and its add-source control is visible.
  expect((await screen.findByLabelText(/Sources:/)).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText("Add source")).toBeTruthy();
});

it("tapping the Drafts tab switches to the drafts panel", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner", [{ id: "i" }]));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  expect(screen.getByLabelText("Generate a draft")).toBeTruthy();
});

it("a reviewer auto-lands on Feedback with an Approve control", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("reviewer", [{ id: "i" }], [{ id: "v1", version_no: 1, is_validated: false, recorded_via: null }]),
  );
  render(<TrustProjectDetail />);
  expect((await screen.findByLabelText(/Feedback:/)).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText(/Approve version 1/)).toBeTruthy();
});

it("keeps the recorded_via chip on a validated version (Feedback)", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(
    proj("owner", [{ id: "i" }], [{ id: "v1", version_no: 1, is_validated: true, recorded_via: "expert_self" }]),
  );
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(screen.getByText("expert-validated")).toBeTruthy();
});
```

(Reuse the `proj(role, inputs, versions)` factory already in the journey test; drop the `borderOf`/highlight cases entirely.)

- [ ] **Step 2: Run — Expected FAIL** (tabs/panels not present yet; TrustJourney import may still exist).
Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail`

- [ ] **Step 3: Implement the restructure** (per the Transformation above). Delete `TrustJourney.tsx` + its test. Remove the `TrustJourney` import from the screen.

- [ ] **Step 4: Run the screen + component + helper tests — Expected PASS.**
Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail __tests__/components/PhaseTabBar __tests__/lib/projectPhase`

- [ ] **Step 5: Full gate + commit**
```bash
cd mobile && npx tsc --noEmit -p tsconfig.json && npx eslint app/trust/\[projectId\].tsx && npx jest
git add mobile/app/trust/\[projectId\].tsx mobile/__tests__/screens/TrustProjectDetail*.tsx mobile/src/help-content/topics.ts
git rm mobile/src/components/TrustJourney.tsx mobile/__tests__/components/TrustJourney.test.tsx
git commit -m "feat(trust): guided phase-tabbed project workspace (wayfinding; ADR-038 O3)"
```

---

## Self-Review

**Spec coverage:** `deriveProjectPhase` → Task 1 ✓; `PhaseTabBar` merged stepper+tabs → Task 2 ✓; tabbed workspace + auto-select + role-adaptive panels + Publish placeholder + remove scroll/flash + retire TrustJourney → Task 3 ✓; tests (helper transitions, tab bar state/tap, screen auto-select/tab-switch/role/recorded_via) → Tasks 1-3 ✓; Help copy → Task 3 ✓.

**Placeholder scan:** none — Task 1 & 2 give full code; Task 3 is a transformation of an existing file with the new scaffolding (selection state, tab wiring, panel boundaries) spelled out and the bulk = "move the existing block JSX into these panels, keep actions unchanged."

**Type consistency:** `PhaseKey`/`ProjectPhase`/`PHASE_LABELS`/`PHASE_ORDER` defined in Task 1, consumed by Tasks 2-3 with matching names; `PhaseTabBar` props `{ phase, selected, onSelect }` match Task 3's usage; `deriveProjectPhase(detail, isOwner)` signature matches all call sites; `active`/`basePhase` collapse `create_artifact`→`create` consistently.

**Scope:** UI-only (no backend/RLS), single screen + two new units + test updates — one implementation plan. The direction doc's Supabase-RLS/`user_roles`/Gemini stack is explicitly out (it's the Lovable prototype's).
