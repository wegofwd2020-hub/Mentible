# Help Engine/Content Seam (Help System Phase 2 — prep) — Design Spec

**Date:** 2026-07-06
**Status:** Approved (brainstorm)
**Implements:** Help System proposal Phase 2, **ADR-019-compliant variant** — establish the
`wegofwd-help` boundary *in-repo* without extracting a package (Help has no second consumer
yet; ADR-019 D3/D5 = "copy-first / extract-on-the-real-second-consumer; no speculative
package"). Mobile-only, **zero user-facing change** — this is a refactor.

## Summary

Split Mentible's Help into two clean modules mirroring the eventual shared package:
- **`mobile/src/help/`** — the **engine** (what would become `wegofwd-help`): schema, search,
  coverage, and the render components/renderer. Product-agnostic surface.
- **`mobile/src/help-content/`** — Mentible's **content pack**: `HELP_TOPICS`, `FEATURES`,
  provider-key defs.

Behavior is identical (same Help tab, same chips, same coverage gate). The payoff: a crisp
engine↔content boundary so that when a real second consumer adopts Help, extraction is a
lift-and-shift, and the boundary is already exercised by one product.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | **Prep in-repo, do not publish a package** (ADR-019). Two modules: `src/help/` (engine) + `src/help-content/` (content). |
| 2 | **Engine schema is product-agnostic.** `HelpBlock.link.href` and `HelpBlock.action.step` become `string` (not Mentible's route union / onboarding `StepId`). The renderer takes `onLink(href)` / `onAction(step)` callbacks; the **screen** wires the app-specific behavior (router, `relaunchStep`). |
| 3 | **`featureKey` stays `string` in the engine schema;** the typed `FeatureKey` union + `FEATURES` live in the content pack. `uncoveredFeatures` is already generic. |
| 4 | **Don't build dependency injection for theme/router now** (YAGNI — the 2nd consumer reveals the real DI needs). Keep the engine components importing `@/constants/theme` + `expo-router`, but **localize + comment** these as the extraction injection points. |
| 5 | **Old `mobile/src/constants/helpContent.ts` is removed** at the end (no lingering compat shim); all imports repoint to `@/help` / `@/help-content`. |

## Target module layout

```
mobile/src/help/                      # ENGINE (future wegofwd-help)
  schema.ts        # HelpBlock, HelpTopic (featureKey?: string), HelpBlockHref removed → string
  search.ts        # blockText(blocks), searchHelpTopics(query, topics)
  coverage.ts      # uncoveredFeatures(features, topics)
  components/
    HelpButton.tsx # ? chip → nav to the help screen (keeps expo-router for now)
    HelpHint.tsx   # inline hint (theme only)
    HelpTopicView.tsx  # extracted from help.tsx: renders a topic's blocks; props
                       #   { topic, onLink(href:string), onAction(step:string) }
  index.ts         # public API: types + search + coverage + components

mobile/src/help-content/              # CONTENT PACK (Mentible-specific)
  features.ts      # FEATURES (as const) + FeatureKey union
  topics.ts        # HELP_TOPICS: HelpTopic[]  (imports providerKeyDefs)
  providerDefs.ts  # providerKeyDefs() (derived from PROVIDER_GUIDES) — Mentible content
  index.ts         # re-export FEATURES, FeatureKey, HELP_TOPICS
```

## What moves where (from today's `constants/helpContent.ts` + components + help.tsx)

| Today | → New home |
|---|---|
| `HelpBlock`, `HelpTopic` types | `src/help/schema.ts` (with `href`/`step`/`featureKey` as `string`) |
| `blockText`, `searchHelpTopics` | `src/help/search.ts` |
| `uncoveredFeatures` | `src/help/coverage.ts` |
| `FEATURES`, `FeatureKey` | `src/help-content/features.ts` |
| `HELP_TOPICS`, `providerKeyDefs()` | `src/help-content/topics.ts` + `providerDefs.ts` |
| `src/components/HelpButton.tsx`, `HelpHint.tsx` | `src/help/components/` |
| `help.tsx`'s `Block`/`Step` renderer | `src/help/components/HelpTopicView.tsx` |

`app/(tabs)/help.tsx` becomes a **thin screen**: it imports `searchHelpTopics` + `HelpTopicView`
from `@/help` and `HELP_TOPICS` from `@/help-content`, renders the search box + list, and
supplies `onLink={(href) => router.push(href)}` and `onAction={(step) => relaunchStep(step as StepId)}`.

## Schema genericization (the one real design point)

The engine must not know Mentible's routes or onboarding steps:
- `HelpBlock.link` → `{ kind: "link"; label: string; href: string }` (was `HelpBlockHref` union).
- `HelpBlock.action` → `{ kind: "action"; label: string; step: string }` (was `StepId`).
- `HelpTopic.featureKey?: string`.

Consequence: the compile-time guarantee that a `link.href` is a real route is lost at the
engine layer. Acceptable — route validity is a **content** concern; the content pack authors
real routes, and the screen's `onLink`/`onAction` handle them. (A future content-side typed
helper can re-narrow if we want the safety back; out of scope now.)

## Rewiring (imports)

11 files import the help modules today. Repoint:
- `@/components/HelpButton` → `@/help` (HelpButton). Sites: settings, books, saved, read,
  generate, sign-in, WizardScaffold, GenerationParamsEditor.
- `@/components/HelpHint` → `@/help`. Sites: account, ProviderKeyForm.
- `@/constants/helpContent` → `@/help` (types/search/coverage) and/or `@/help-content`
  (FEATURES/HELP_TOPICS). Sites: help.tsx, coverage test.

Delete `mobile/src/constants/helpContent.ts` and `mobile/src/components/HelpButton.tsx` /
`HelpHint.tsx` once nothing imports the old paths.

## Testing

- **Behavior identical:** the full mobile suite (currently **405**) stays green; `tsc` + lint
  clean. No test asserts new behavior — the win is structural.
- **Coverage gate still bites:** `mobile/__tests__/help/coverage.test.ts` imports `FEATURES` +
  `HELP_TOPICS` from `@/help-content` and `uncoveredFeatures` from `@/help`; its 3 assertions
  (all covered / self-check flags a synthetic key / no orphan keys) still pass. This proves the
  Phase-1 gate survives the seam.
- **Engine unit tests** (small, prove the engine is self-contained): a `src/help/__tests__` (or
  under `__tests__/help/`) test for `searchHelpTopics` (matches on title + keyword + block text)
  and `uncoveredFeatures` (against synthetic inputs) — importing ONLY from `@/help` (no content),
  demonstrating the engine stands alone.

## Extraction-readiness notes (documented, not built)

The engine's only Mentible couplings after this refactor are: **`@/constants/theme`** (tokens,
used by all three components) and **`expo-router`** (HelpButton nav; the screen's `onLink`). These
are the injection points a future `wegofwd-help` extraction will parameterize (theme via props/
context, nav via a callback). A short comment in `src/help/index.ts` records this so the
extraction is obvious. We do **not** invert them now (ADR-019 — the second consumer defines the
real seam).

## Files

**Create:** `mobile/src/help/{schema,search,coverage,index}.ts`,
`mobile/src/help/components/{HelpButton,HelpHint,HelpTopicView}.tsx`,
`mobile/src/help-content/{features,topics,providerDefs,index}.ts`, engine unit test(s).
**Modify:** `mobile/app/(tabs)/help.tsx` (thin screen), the ~11 import sites,
`mobile/__tests__/help/coverage.test.ts` (import paths).
**Delete:** `mobile/src/constants/helpContent.ts`, `mobile/src/components/HelpButton.tsx`,
`mobile/src/components/HelpHint.tsx`.

## Phasing (for the plan)
1. **Engine logic + content pack (no components):** create `src/help/{schema,search,coverage}` +
   `src/help-content/{features,topics,providerDefs}`; make `constants/helpContent.ts` a thin
   re-export from the new modules (temporary) so nothing breaks; engine unit tests; full suite green.
2. **Engine components + renderer:** move `HelpButton`/`HelpHint` into `src/help/components`;
   extract `HelpTopicView` from `help.tsx`; make `help.tsx` a thin screen wiring `onLink`/`onAction`.
   Full suite green.
3. **Rewire + delete the shim:** repoint all ~11 import sites to `@/help`/`@/help-content`; update
   the coverage test's imports; delete `constants/helpContent.ts` + the old component files. Full
   suite + `tsc` + lint green.

## Rollout
Mobile-only, no backend, **no user-facing change**. Ships in the next web deploy like any refactor;
no APK needed (nothing visible changed). Sets up (does not perform) the eventual `wegofwd-help`
extraction — which stays gated on a real second consumer per ADR-019.
