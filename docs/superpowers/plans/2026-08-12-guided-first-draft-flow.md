# Guided first-draft flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand-hold a project owner from a new project to a first working AI draft via an adaptive
next-step banner (Add source → Suggest structure → Generate first topic) plus new-project field
clarity. The banner fades once a topic is drafted.

**Architecture:** A pure `nextStep(state)` helper drives a `NextStepBanner` rendered atop the trust
workspace; its CTA switches the phase tab (and, for the generate step, opens the Drafts panel in
per-topic mode via a new `initialMode` prop). New-project copy is placeholder/subhead only. No
backend change.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-guided-first-draft-flow-design.md`.
- **Mobile-only. No backend/schema/migration/generation-behavior change.** The banner only READS
  `ProjectDetailView` state and calls the existing `setSelected(phase)`.
- **Owner-only** (`project.my_role === "owner"`); banner returns nothing once a topic is drafted.
- Path is **through Structure → per-topic** (decided); do NOT route to the whole-book path.
- `nextStep` is a **pure function**, read defensively (missing/odd fields must not throw).
- `useThemedStyles`; reuse existing primitives (`Card`, `Button`, `Label`, `AccentText`); **NO
  color-literal test asserts**.
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/lib/nextStep.ts` — NEW pure helper (T1)
- `mobile/app/trust/[projectId].tsx` — banner render + `desiredDraftMode` state + `DraftsPanel`
  `initialMode` prop (T2)
- `mobile/app/trust/new.tsx` — subhead + per-field placeholders (T3)
- Tests under `mobile/__tests__/`

Key facts (verified in the codebase):
- The workspace screen (bottom of `[projectId].tsx`) holds `const [selected, setSelected] =
  useState<PhaseKey|null>(...)`; `active = selected ?? basePhase(phase.currentKey)`;
  `<PhaseTabBar ... onSelect={setSelected}/>` renders at ~line 1472; `isOwner = project.my_role ===
  "owner"` (~1460). Panels render conditionally: `active === "capture"|"structure"|"create"|...`.
- `DraftsPanel` (function at line 450) is the panel for `active === "create"`; it owns
  `const [mode, setMode] = useState<"whole"|"topic">("whole")` at ~line 487 (this is the per-topic
  toggle). Panels unmount/remount on tab switch (conditional render), so an `initialMode` prop read
  into that `useState` initializer takes effect on tab entry.
- `PhaseKey` (from `@/lib/projectPhase`) = `"capture" | "structure" | "create" | "validate" |
  "share"`. `TopicStatusView.status` = `"not_generated" | "drafted" | "validated"`.
- `ProjectDetailView`: `project.project.toc?.subjects`, `inputs`, `topic_status?`, `my_role`.

---

### Task 1: `nextStep` pure helper

**Files:**
- Create: `mobile/src/lib/nextStep.ts`
- Test: `mobile/__tests__/lib/nextStep.test.ts` (new)

**Interfaces:**
- Produces:
```ts
export type NextStep = {
  key: "add_source" | "suggest_structure" | "generate_topic";
  title: string;
  body: string;
  ctaLabel: string;
  target: { phase: "capture" | "structure" | "create"; draftMode?: "topic" };
};
export function nextStep(args: {
  isOwner: boolean;
  inputCount: number;
  tocSubjectCount: number;
  anyTopicDrafted: boolean;
}): NextStep | null;
```

- [ ] **Step 1: Write the failing test** (`nextStep.test.ts`):
```ts
import { nextStep } from "@/lib/nextStep";
const base = { isOwner: true, inputCount: 0, tocSubjectCount: 0, anyTopicDrafted: false };
it("reviewer / non-owner gets no step", () => {
  expect(nextStep({ ...base, isOwner: false })).toBeNull();
});
it("owner with no sources → add_source (Input)", () => {
  const s = nextStep(base)!;
  expect(s.key).toBe("add_source");
  expect(s.target.phase).toBe("capture");
});
it("sources but no TOC → suggest_structure (Structure)", () => {
  const s = nextStep({ ...base, inputCount: 2 })!;
  expect(s.key).toBe("suggest_structure");
  expect(s.target.phase).toBe("structure");
});
it("TOC but nothing drafted → generate_topic (Drafts, per-topic)", () => {
  const s = nextStep({ ...base, inputCount: 2, tocSubjectCount: 1 })!;
  expect(s.key).toBe("generate_topic");
  expect(s.target).toEqual({ phase: "create", draftMode: "topic" });
});
it("a topic already drafted → no step (goal reached)", () => {
  expect(nextStep({ isOwner: true, inputCount: 2, tocSubjectCount: 1, anyTopicDrafted: true })).toBeNull();
});
```

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/lib/nextStep.test.ts`.

- [ ] **Step 3: Implement `nextStep.ts`:**
```ts
// Which single next action moves an owner toward their first working AI draft.
// Pure + defensive: returns null for non-owners and once a topic is drafted.
export type NextStep = {
  key: "add_source" | "suggest_structure" | "generate_topic";
  title: string;
  body: string;
  ctaLabel: string;
  target: { phase: "capture" | "structure" | "create"; draftMode?: "topic" };
};

export function nextStep(args: {
  isOwner: boolean;
  inputCount: number;
  tocSubjectCount: number;
  anyTopicDrafted: boolean;
}): NextStep | null {
  if (!args.isOwner || args.anyTopicDrafted) return null;
  if (args.inputCount <= 0) {
    return {
      key: "add_source",
      title: "Add your first source",
      body: "The studio drafts only from what you provide — nothing invented.",
      ctaLabel: "Add a source",
      target: { phase: "capture" },
    };
  }
  if (args.tocSubjectCount <= 0) {
    return {
      key: "suggest_structure",
      title: "Suggest a structure",
      body: "Turn your sources into a table of contents to draft against.",
      ctaLabel: "Suggest a structure",
      target: { phase: "structure" },
    };
  }
  return {
    key: "generate_topic",
    title: "Generate your first topic",
    body: "Pick a topic and draft it from your sources.",
    ctaLabel: "Generate a topic",
    target: { phase: "create", draftMode: "topic" },
  };
}
```

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__/lib/nextStep.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/lib/nextStep.ts mobile/__tests__/lib/nextStep.test.ts
git commit -m "feat(trust): nextStep helper — the one action toward a first AI draft"
```

---

### Task 2: Next-step banner in the workspace

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: the existing `[projectId]` workspace test (extend) or a focused new test.

**Interfaces:**
- Consumes: `nextStep` (T1).
- The screen gains `const [desiredDraftMode, setDesiredDraftMode] = useState<"whole"|"topic">("whole")`.
- `DraftsPanel` gains prop `initialMode?: "whole" | "topic"` (default `"whole"`), used as its `mode`
  `useState` initializer: `const [mode, setMode] = useState<"whole"|"topic">(initialMode ?? "whole")`.

- [ ] **Step 1: Write the failing test.** In the workspace test, render as owner (mock
  `useTrustProject`/`ProjectDetailView` per the file's existing seam) and assert:
  - Owner, 0 inputs → a banner with text "Add your first source" and a CTA "Add a source" renders;
    pressing the CTA selects the Input tab (assert the Input phase content / tab active state).
  - Owner with a drafted topic (`topic_status` has a `"drafted"`) → no banner (query returns null).
  - Reviewer (`my_role !== "owner"`) → no banner.
  Follow the file's existing render/mock helpers; no color-literal asserts.

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest <workspace test>`.

- [ ] **Step 3: Compute the step + render the banner.** In the screen component (after `isOwner`,
  `project` are available, before/above `<PhaseTabBar>` at ~line 1472):
  - Derive:
```ts
const step = nextStep({
  isOwner,
  inputCount: inputs.length,
  tocSubjectCount: project.project.toc?.subjects?.length ?? 0,
  anyTopicDrafted: (project.topic_status ?? []).some(
    (s) => s.status === "drafted" || s.status === "validated",
  ),
});
```
  - Render a `NextStepBanner` (a small in-file component or inline `Card`) when `step` is non-null,
    directly above `<PhaseTabBar>`:
    - Title = `step.title` (reuse the Playfair heading style used elsewhere), body = `step.body`
      (muted), a primary `<Button variant="primary" label={step.ctaLabel}>`.
    - On CTA press: `if (step.target.draftMode) setDesiredDraftMode(step.target.draftMode);`
      then `setSelected(step.target.phase);`.
    - `accessibilityLabel` = `step.ctaLabel`.
  - Reuse `Card`, `Button`, `Label`/`AccentText`, `useThemedStyles`. No new color literals.

- [ ] **Step 4: Per-topic landing.** Add `desiredDraftMode` state (default `"whole"`) to the screen.
  Pass `initialMode={desiredDraftMode}` to `<DraftsPanel .../>` (the `active === "create"` render,
  ~line 1506). In `DraftsPanel` (function line 450), add `initialMode` to its props + type, and
  change `const [mode, setMode] = useState<"whole"|"topic">("whole")` (~line 487) to
  `useState<"whole"|"topic">(initialMode ?? "whole")`. Do NOT change the other panels' `mode`.

- [ ] **Step 5: Run** — `cd mobile && npx jest <workspace test> && npx tsc --noEmit`.

- [ ] **Step 6: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__
git commit -m "feat(trust): adaptive next-step banner guiding owners to a first draft"
```

---

### Task 3: New-project placeholders + subhead

**Files:**
- Modify: `mobile/app/trust/new.tsx`
- Test: its test (extend) or a focused new test.

- [ ] **Step 1: Write/extend the test** — assert (RNTL) the subhead text is present and the Title
  field has a non-empty `placeholder`. Keep it light; no color literals.

- [ ] **Step 2: Implement (copy-only).** In `new.tsx`:
  - Add a heading + subhead above the fields: a Playfair title "New project" (reuse an existing
    heading style/primitive) and a muted line "Give your studio a topic to work on. You can refine
    any of this later."
  - Extend the `field()` helper to accept a `placeholder` and pass it to the `TextInput`
    (`placeholder={placeholder}` + keep `placeholderTextColor={theme.textMuted}`). Set:
    - Title → "Post-mortems that change engineering culture"
    - Topic → "The specific insight or angle you want to develop"
    - Audience → "Senior engineering leaders"
    - Goal → "Teach · Thought leadership · Lead-gen"
  - No field add/remove/reorder, no submit change.

- [ ] **Step 3: Run** — `cd mobile && npx jest <new.tsx test> && npx tsc --noEmit`.

- [ ] **Step 4: Commit.**
```bash
git add "mobile/app/trust/new.tsx" mobile/__tests__
git commit -m "feat(trust): new-project subhead + field placeholders"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] No backend/schema/migration touched (grep the diff: only the 3 files + tests).
- [ ] **Web screenshot verify** (recipe: local expo web + stub `ProjectDetailView` + dev-token patch,
  see the 08-11 pin): a fresh owner project (0 sources) shows the "Add your first source" banner;
  CTA → Input tab; after a stubbed source + TOC + a drafted topic, the banner is gone. New-project
  form shows the subhead + placeholders.
- [ ] PR body: guided first-draft wayfinding (banner + new-project clarity); adapts the Lovable flow;
  mobile-only → web redeploy, no backend.

## Self-Review

- **Spec coverage:** `nextStep` helper (T1) · banner + per-topic landing (T2) · new-project copy (T3).
  Feedback/Publish/whole-book/backend correctly out of scope.
- **Type consistency:** `NextStep.target.phase` values are a subset of `PhaseKey`, valid for
  `setSelected`. `initialMode` matches `DraftsPanel`'s `"whole"|"topic"`.
- **Constraints:** mobile-only; owner-only; pure defensive helper; reuse primitives; no color-literal
  asserts.
