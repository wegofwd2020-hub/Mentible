# Help Coverage Gate (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `featureKey` to Help topics + a `FEATURES` registry + a jest coverage test that hard-fails when a declared feature has no Help topic (enforced by the existing Mobile CI job).

**Architecture:** Extend `helpContent.ts` with `FEATURES` (declared user-facing features), a `FeatureKey` type, an optional `featureKey` on `HelpTopic`, and a pure `uncoveredFeatures()` function. A jest test asserts full coverage + proves the gate bites. Backfill the 7 existing feature topics. Mobile-only, no backend.

**Tech Stack:** TypeScript · Jest.

## Global Constraints

- **Hard fail:** the coverage test must fail CI when a `FEATURES` entry has no covering topic (not warn-only).
- **Minimal schema:** add only `featureKey?: FeatureKey` to `HelpTopic` — no `audience`/`surfaces` (deferred).
- `FEATURES`/`FeatureKey`/`uncoveredFeatures` are **co-located in `mobile/src/constants/helpContent.ts`**.
- General topics (`getting-started`, `troubleshooting`, `glossary`) carry **no** `featureKey`.
- `uncoveredFeatures` takes **loose param types** so the self-check can pass synthetic inputs without a `@ts-expect-error`.
- Ships green (all 7 features backfilled). Mobile cmds from `mobile/`: `npx jest <path>`, `npm run typecheck`, `npx eslint <file>`.

---

### Task 1: featureKey schema + FEATURES registry + coverage gate

**Files:**
- Modify: `mobile/src/constants/helpContent.ts`
- Create: `mobile/__tests__/help/coverage.test.ts`
- Modify: `CLAUDE.md`, `docs/proposals/2026-07-05-help-system.md`

**Interfaces:**
- Produces:
  ```ts
  export const FEATURES: readonly { key: string; label: string }[]
  export type FeatureKey = (typeof FEATURES)[number]["key"]
  export function uncoveredFeatures(
    features: readonly { key: string }[],
    topics: readonly { featureKey?: string }[],
  ): string[]   // feature keys with no covering topic
  // HelpTopic gains: featureKey?: FeatureKey
  ```

- [ ] **Step 1: Write the failing coverage test**

Create `mobile/__tests__/help/coverage.test.ts`:

```ts
import { FEATURES, HELP_TOPICS, uncoveredFeatures } from "@/constants/helpContent";

describe("help coverage gate", () => {
  it("every declared feature has at least one Help topic", () => {
    // If this fails, add a topic (with the right featureKey) for each key listed.
    expect(uncoveredFeatures(FEATURES, HELP_TOPICS)).toEqual([]);
  });

  it("uncoveredFeatures actually flags a feature with no topic (the gate bites)", () => {
    const synthetic = [...FEATURES, { key: "not-documented", label: "X" }];
    expect(uncoveredFeatures(synthetic, HELP_TOPICS)).toEqual(["not-documented"]);
  });

  it("no topic references a featureKey that isn't in FEATURES", () => {
    const valid = new Set(FEATURES.map((f) => f.key));
    const orphans = HELP_TOPICS.filter((t) => t.featureKey && !valid.has(t.featureKey)).map((t) => t.id);
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `mobile/`): `npx jest __tests__/help/coverage.test.ts`
Expected: FAIL — `FEATURES` / `uncoveredFeatures` are not exported from `helpContent.ts` (import error).

- [ ] **Step 3: Add `FEATURES`, `FeatureKey`, `uncoveredFeatures`, and the `featureKey` field**

In `mobile/src/constants/helpContent.ts`, immediately **after** the `HelpTopic` interface definition, add:

```ts
// The user-facing features that MUST have in-app help. Declaring a feature here
// is what makes the coverage gate (see __tests__/help/coverage.test.ts) require a
// Help topic for it — that's the Definition-of-Done enforcement (see CLAUDE.md).
export const FEATURES = [
  { key: "generation", label: "Generating a book" },
  { key: "reading", label: "Reading a book" },
  { key: "provider-keys", label: "Provider API keys (BYOK)" },
  { key: "diagrams", label: "Diagrams" },
  { key: "export", label: "Export (EPUB3 / PDF)" },
  { key: "sharing", label: "Draft sharing" },
  { key: "accounts", label: "Accounts & sign-in" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

// Feature keys that have no covering topic. Loose param types so a synthetic
// FEATURES list can be passed in tests.
export function uncoveredFeatures(
  features: readonly { key: string }[],
  topics: readonly { featureKey?: string }[],
): string[] {
  const covered = new Set(topics.map((t) => t.featureKey).filter((k): k is string => Boolean(k)));
  return features.map((f) => f.key).filter((k) => !covered.has(k));
}
```

Then add `featureKey` to the `HelpTopic` interface:

```ts
export interface HelpTopic {
  id: string;
  title: string;
  keywords: string[];
  blocks: HelpBlock[];
  featureKey?: FeatureKey; // links this topic to a required feature (coverage gate)
}
```

- [ ] **Step 4: Backfill `featureKey` on the 7 feature topics**

In the `HELP_TOPICS` array in the same file, add a `featureKey` field to each of these topics (add the line right after the topic's `title:` line). Leave `getting-started`, `troubleshooting`, and `glossary` untouched.

| topic `id:` | add field |
|---|---|
| `scoped-generation` | `featureKey: "generation",` |
| `reading-a-book` | `featureKey: "reading",` |
| `provider-keys` | `featureKey: "provider-keys",` |
| `diagram-types` | `featureKey: "diagrams",` |
| `formats` | `featureKey: "export",` |
| `share-a-draft` | `featureKey: "sharing",` |
| `getting-started-account` | `featureKey: "accounts",` |

Example (the `share-a-draft` topic):
```ts
  {
    id: "share-a-draft",
    title: "Share a draft for feedback",
    featureKey: "sharing",
    keywords: [ /* … unchanged … */ ],
    blocks: [ /* … unchanged … */ ],
  },
```

- [ ] **Step 5: Run to verify pass + typecheck + lint**

Run: `npx jest __tests__/help/coverage.test.ts` → PASS (3).
Run: `npx jest` (full suite) → green. `npm run typecheck` → clean. `npx eslint src/constants/helpContent.ts` → no new errors.

- [ ] **Step 6: Update the Definition-of-Done in CLAUDE.md**

In `CLAUDE.md`, replace the existing "Definition of Done — help stays current" paragraph body with wording that references the now-enforced gate:

Find:
```
When a PR adds or changes a user-facing surface, add or update a topic in
`mobile/src/constants/helpContent.ts` (and a contextual `HelpButton`/`HelpHint`
where it helps) in the *same* PR. Help is authored as data (one topic → renders
on the Help tab + hints), so this is cheap. See the Help System proposal at
`docs/proposals/2026-07-05-help-system.md` (Phase 1 will make this a CI coverage
check; until then it's this checklist + the PR template).
```
Replace with:
```
Shipping a user-facing feature means: add its key to `FEATURES` in
`mobile/src/constants/helpContent.ts` and a Help topic with that `featureKey`, in
the *same* PR. The coverage gate (`mobile/__tests__/help/coverage.test.ts`, run in
the Mobile CI job) **fails** when a declared feature has no topic — so this is
enforced, not just a checklist. Help is authored as data (one topic → renders on
the Help tab + hints). See `docs/proposals/2026-07-05-help-system.md`.
```

- [ ] **Step 7: Mark Phase 1 in the proposal**

In `docs/proposals/2026-07-05-help-system.md`, in the "Phased rollout" section, update the Phase 1 line to note it is delivered by this spec/plan. Change:
```
- **Phase 1 — Formalize the model in Mentible:** extend `helpContent.ts` to the Topic schema (audience/surfaces/featureKey); wire the coverage CI check. Prove it in one product. (Days.)
```
to:
```
- **Phase 1 — Formalize the model in Mentible:** ✅ `featureKey` + `FEATURES` registry + a hard-fail coverage gate shipped (spec `docs/superpowers/specs/2026-07-05-help-coverage-gate-design.md`). `audience`/`surfaces` still deferred to Phase 2.
```

- [ ] **Step 8: Commit**

```bash
git add mobile/src/constants/helpContent.ts mobile/__tests__/help/coverage.test.ts CLAUDE.md docs/proposals/2026-07-05-help-system.md
git commit -m "feat(help): featureKey schema + FEATURES registry + hard-fail coverage gate"
```

---

## Self-Review

**Spec coverage:**
- `featureKey?` on `HelpTopic` + `FeatureKey` + `FEATURES` → Task 1 Step 3. ✔
- Backfill the 7 feature topics → Step 4. ✔
- Coverage gate: every feature covered (assert 1) + no orphan keys (assert 3) → Step 1. ✔
- Self-check that the gate isn't a no-op → Step 1 assert 2 (`uncoveredFeatures` with a synthetic extra key). ✔
- Runs in the existing Mobile CI job (a jest test) → Step 5 (`npx jest`). ✔
- CLAUDE.md DoD + proposal updates → Steps 6, 7. ✔
- Ships green (all features backfilled) → Step 5 (assert 1 passes). ✔

**Placeholder scan:** none — full code for the schema, function, and test; backfill is an explicit per-topic table + a worked example; the two doc edits show exact find/replace text. ✔

**Type consistency:** `FEATURES` (`as const`) → `FeatureKey` union → `featureKey?: FeatureKey` on `HelpTopic`; `uncoveredFeatures(features, topics)` loose types accept both the real `FEATURES`/`HELP_TOPICS` and the synthetic self-check input; the test imports `FEATURES`, `HELP_TOPICS`, `uncoveredFeatures` — all exported in Step 3. ✔
