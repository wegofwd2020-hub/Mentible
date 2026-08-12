# Guided first-draft flow — Design

**Status:** Approved (brainstorming, 2026-08-12). Adapts the wayfinding from Sridhar's Lovable UX
prototype ([[project_lovable_ux_teardown]]) onto our shipped trust/Projects workspace. Addresses the
standing gap [[feedback_real_gap_is_wayfinding]] + Sridhar's Input→Draft "what do I do next?"
friction [[feedback_sridhar_testrun_2026-08-07]]: a new owner can create a project but nothing tells
them how to reach a first working AI draft.

## Problem

In `mobile/app/trust/[projectId].tsx` the phase tabs (Input · Structure · Drafts · Feedback ·
Publish) each have an empty-state, but **nothing links one phase to the next**. Add a source → you
stay on Input; nothing says "now suggest a structure," then "now generate a topic." And
`trust/new.tsx` is a bare 4-field form with no hints. The result: users stall before their first
draft.

## Goal

Hand-hold an owner through **steps 1–3 to a first working AI draft**, via the chosen path:
**① New project → ② Add source (Input) → ③ Suggest a structure (Structure) → ④ Generate first topic
(Drafts, per-topic)**. Additive, owner-only, no rebuild, no backend change. The guide **fades out
once a first topic draft exists** — the moment the goal is reached.

## Locked decisions (brainstorming 2026-08-12)

1. **Path = through Structure → per-topic** (not whole-book, not a user choice). The #410 Suggest-TOC
   524 fix makes this safe on the happy path.
2. **Mechanism = an adaptive next-step banner** at the top of the workspace — one primary CTA that
   switches to the right phase. **No auto-advancing tabs**, no persistent checklist.
3. **Fades out after the first topic draft** — does not continue into Validate/Publish.
4. **Scope = steps 1–3 only.** No Feedback/Publish changes, no whole-book path, no backend change.

## Architecture

### A. New-project clarity — `mobile/app/trust/new.tsx`
Copy-only: add a one-line subhead under the (currently absent) heading —
*"Give your studio a topic to work on. You can refine any of this later."* — and a helpful
`placeholder` per field. No field add/remove/reorder, no behavior change.
- Title → e.g. `"Post-mortems that change engineering culture"`
- Topic → `"The specific insight or angle you want to develop"`
- Audience → `"Senior engineering leaders"`
- Goal → `"Teach · Thought leadership · Lead-gen"`

### B. Adaptive next-step banner — `mobile/app/trust/[projectId].tsx`

**Pure state helper** (new, unit-testable — mirrors `describeProvenance`'s shape):
`mobile/src/lib/nextStep.ts`
```ts
export type NextStep = {
  key: "add_source" | "suggest_structure" | "generate_topic";
  title: string;
  body: string;
  ctaLabel: string;
  target: { phase: "capture" | "structure" | "create"; draftMode?: "topic" };
};
// Returns null when: not owner, OR a first topic draft already exists (goal reached).
export function nextStep(args: {
  isOwner: boolean;
  inputCount: number;
  tocSubjectCount: number;
  anyTopicDrafted: boolean;
}): NextStep | null;
```
Logic (first match; `null` if `!isOwner` or `anyTopicDrafted`):
- `inputCount === 0` → **add_source**: "Add your first source" / "The studio drafts only from what
  you provide — nothing invented." / CTA "Add a source" → `{phase:"capture"}`.
- `tocSubjectCount === 0` → **suggest_structure**: "Suggest a structure" / "Turn your sources into a
  table of contents to draft against." / CTA "Suggest a structure" → `{phase:"structure"}`.
- else → **generate_topic**: "Generate your first topic" / "Pick a topic and draft it from your
  sources." / CTA "Generate a topic" → `{phase:"create", draftMode:"topic"}`.

**Inputs from `ProjectDetailView`** (all already present, no backend change):
- `isOwner = project.my_role === "owner"`
- `inputCount = inputs.length`
- `tocSubjectCount = project.project.toc?.subjects?.length ?? 0`
- `anyTopicDrafted = (topic_status ?? []).some(s => s.status === "drafted" || s.status === "validated")`

**Banner component** `NextStepBanner` (in-file or a small component): renders the step's title/body
and a primary CTA. On press: `setSelected(step.target.phase)` and, when `step.target.draftMode`,
sets the screen-level `desiredDraftMode` so the Drafts panel opens in per-topic mode. Renders
**above `<PhaseTabBar>`** (after the project header). Returns nothing when `nextStep` is `null`.

**Per-topic landing wrinkle.** Each panel owns its `mode` (`"whole" | "topic"`) locally, and panels
mount/unmount on tab switch (conditional render). So the Drafts/Create panel gains an
`initialMode?: "whole" | "topic"` prop used as its `useState` initializer; the screen holds
`desiredDraftMode` (default `"whole"`), the banner's generate-topic CTA sets it to `"topic"` before
selecting the create tab, and the panel — remounting on tab entry — opens in per-topic mode. The
other panels (Structure, Validate) are untouched.

## Testing

- **`nextStep` (unit):** `!isOwner` → null; owner + 0 inputs → `add_source`; +inputs, 0 toc →
  `suggest_structure`; +toc, none drafted → `generate_topic` (with `draftMode:"topic"`); any drafted
  → null. Malformed/missing fields don't throw.
- **Banner (RNTL):** owner with 0 sources sees "Add your first source" + CTA; pressing it selects the
  Input tab. Owner with a drafted topic → no banner. Reviewer → no banner.
- **new.tsx:** placeholders + subhead present (query by placeholder/text).
- No color-literal asserts; `useThemedStyles`; existing styles/primitives (`Card`, `Button`,
  `Label`, `AccentText`).

## Files

- Create: `mobile/src/lib/nextStep.ts`
- Modify: `mobile/app/trust/[projectId].tsx` (banner + `desiredDraftMode` + Drafts panel
  `initialMode` prop)
- Modify: `mobile/app/trust/new.tsx` (subhead + placeholders)
- Tests under `mobile/__tests__/`

## Decomposition (SDD)

- **T1 — `nextStep` helper + tests** (pure, isolated).
- **T2 — next-step banner in the workspace** (render `nextStep`, CTA switches tab; Drafts
  `initialMode` + `desiredDraftMode` for per-topic landing). Depends on T1.
- **T3 — new-project placeholders + subhead** (copy-only; independent).

## Rollout

Mobile-only → **web redeploy**, no backend, no migration.

## Out of scope

- Feedback/Publish guidance, whole-book path, auto-advancing tabs, a persistent checklist.
- Any generation-behavior or backend change. The banner only reads state + switches tabs.
- Onboarding for reviewers (they don't author).

## Global constraints

Mobile-only, no generation-behavior/backend change. Owner-only; banner disappears once a topic is
drafted. `nextStep` is a pure function read defensively. `useThemedStyles`; reuse existing
primitives; **no color-literal test asserts**. `npx tsc --noEmit` clean + full `npx jest` green.
Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
