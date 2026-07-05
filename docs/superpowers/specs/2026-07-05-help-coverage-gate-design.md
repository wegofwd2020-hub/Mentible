# Help Coverage Gate (Help System Phase 1) — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Implements:** Phase 1 of the Help System proposal (`docs/proposals/2026-07-05-help-system.md`) — formalize the topic schema with a feature key + a CI coverage gate. Mobile-only, no backend.

## Summary

Turn the "help stays current" Definition-of-Done from a checklist into an **enforced CI
gate**. Add a `featureKey` to the Help topic schema, a hand-declared `FEATURES` registry
of user-facing features that require help, and a **jest coverage test** (runs in the
existing Mobile CI job) that **fails** when a declared feature has no Help topic — so a PR
that ships a feature without documenting it cannot merge.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | **Hard fail.** The coverage test fails CI (Mobile — Typecheck, Lint & Tests) when a `FEATURES` entry has no matching topic. Not warn-only. |
| 2 | **Minimal schema.** Add only `featureKey?: FeatureKey` to `HelpTopic` now. Defer `audience` / `surfaces` (multi-surface rendering, Phase 2). |
| 3 | **Explicit registry.** `FEATURES` is a hand-declared list of the user-facing features that require help; declaring a feature there is what forces its topic. General topics (troubleshooting, glossary, getting-started) carry no `featureKey`. |
| 4 | **Co-located.** `FeatureKey` + `FEATURES` live in `helpContent.ts` for now (can move to their own module later). |
| 5 | **Gate is a jest test** — no new CI workflow step; the existing Mobile job runs it. |

## Schema changes (`mobile/src/constants/helpContent.ts`)

```ts
// The user-facing features that MUST have in-app help. Adding a feature here is a
// declaration that it exists — the coverage test then requires a topic for it.
export const FEATURES = [
  { key: "generation",   label: "Generating a book" },
  { key: "reading",      label: "Reading a book" },
  { key: "provider-keys",label: "Provider API keys (BYOK)" },
  { key: "diagrams",     label: "Diagrams" },
  { key: "export",       label: "Export (EPUB3 / PDF)" },
  { key: "sharing",      label: "Draft sharing" },
  { key: "accounts",     label: "Accounts & sign-in" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

export interface HelpTopic {
  id: string;
  title: string;
  keywords: string[];
  blocks: HelpBlock[];
  featureKey?: FeatureKey; // NEW — links this topic to a required feature
}
```

## Backfill (assign `featureKey` to existing feature topics)

| Topic id | `featureKey` |
|---|---|
| `scoped-generation` | `generation` |
| `reading-a-book` | `reading` |
| `provider-keys` | `provider-keys` |
| `diagram-types` | `diagrams` |
| `formats` | `export` |
| `share-a-draft` | `sharing` |
| `getting-started-account` | `accounts` |
| `getting-started`, `troubleshooting`, `glossary` | *(none — general topics)* |

Every `FEATURES` key thus has exactly one covering topic at the outset (gate green on merge).

## Coverage gate (`mobile/__tests__/help/coverage.test.ts`)

Two assertions:

1. **Every feature is documented.** For each `FEATURES` entry, at least one `HELP_TOPICS`
   topic has `featureKey === entry.key`. On failure, the message lists the uncovered
   feature keys (so the author knows exactly what to write).
2. **No orphan/typo feature keys.** Every topic whose `featureKey` is set uses a value that
   exists in `FEATURES`. (TypeScript already constrains the type, but the test guards
   against a `FEATURES` entry being removed while a topic still references it.)

Both run in the existing Mobile CI job (`npx jest`); a red test blocks merge.

## Docs

- **CLAUDE.md** — update the Definition-of-Done note: shipping a user-facing feature means
  *add its key to `FEATURES` and a topic with that `featureKey`, in the same PR* (the
  coverage test enforces it).
- **`docs/proposals/2026-07-05-help-system.md`** — mark Phase 1 as done / in-progress and
  point at this spec.

## Testing

- `coverage.test.ts` asserts the two rules above against the real `FEATURES` + `HELP_TOPICS`.
- A **self-check within the test** proves the gate actually bites: build a synthetic
  `FEATURES`-with-an-extra-key + the real topics and assert the coverage function reports
  the extra key as uncovered (so we know it isn't a no-op that always passes).
- Full mobile suite + `tsc` + lint green. (The coverage logic should be a small pure
  function, `uncoveredFeatures(features, topics): string[]`, so the self-check can call it
  directly with synthetic inputs.)

## Files

- Modify: `mobile/src/constants/helpContent.ts` (`FEATURES`, `FeatureKey`, `featureKey` on
  `HelpTopic`, backfill, export `uncoveredFeatures`).
- Create: `mobile/__tests__/help/coverage.test.ts`.
- Modify: `CLAUDE.md`, `docs/proposals/2026-07-05-help-system.md`.

## Scope / out of scope

- **In:** `featureKey` schema, `FEATURES` registry, the coverage function + jest gate,
  backfill, doc updates.
- **Out:** `audience`/`surfaces` fields, multi-surface rendering, the `wegofwd-help` package
  extraction, contextual-hint coverage, public help site — later phases.

## Rollout

Mobile-only, no backend/migration. The gate ships green (all features backfilled). From
then on, a feature without a topic turns the Mobile CI job red. Ships in the next web deploy
+ APK like any mobile change.
