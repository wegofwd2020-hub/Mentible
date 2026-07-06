# Help Engine/Content Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Mentible's Help into a product-agnostic engine (`src/help/`) and a Mentible content pack (`src/help-content/`), mirroring the future `wegofwd-help` package — with zero user-facing change.

**Architecture:** A refactor. Move schema/search/coverage + the render components into `src/help/` with a generic schema (`href`/`step`/`featureKey` are `string`); move `FEATURES`/`HELP_TOPICS`/provider defs into `src/help-content/`. The Help screen wires the app-specific `onLink`/`onAction`. A temporary compat shim keeps everything green between tasks, then is deleted.

**Tech Stack:** TypeScript · React Native + Expo · Jest.

## Global Constraints

- **No user-facing change** — same Help tab, chips, coverage gate. The full mobile suite (currently **405**) + `tsc` + lint stay green after every task.
- **Engine schema is product-agnostic:** `HelpBlock.link.href: string`, `HelpBlock.action.step: string`, `HelpTopic.featureKey?: string` (no `HelpHref` union, no `StepId`, no `FeatureKey` in the engine).
- `searchHelpTopics(query, topics)` in the engine has **no default** `topics` param (the engine must not reference content). The compat shim re-adds the default during transition.
- **Do not build DI** for theme/router — engine components keep importing `@/constants/theme` + `expo-router`; document them as extraction injection points (a comment in `src/help/index.ts`).
- App route/step validity is a **content/screen** concern — the screen casts `href`→route and `step`→`StepId`.
- Mobile cmds from `mobile/`: `npx jest <path>`, `npm run typecheck`, `npx eslint <files>`.

---

### Task 1: Engine logic + content pack + compat shim

**Files:**
- Create: `mobile/src/help/{schema.ts,search.ts,coverage.ts,index.ts}`, `mobile/src/help-content/{features.ts,providerDefs.ts,topics.ts,index.ts}`, `mobile/__tests__/help/engine.test.ts`
- Modify: `mobile/src/constants/helpContent.ts` (→ compat shim)

**Interfaces:**
- Produces: `@/help` exports `HelpBlock`, `HelpTopic`, `blockText`, `searchHelpTopics(query, topics)`, `uncoveredFeatures`. `@/help-content` exports `FEATURES`, `FeatureKey`, `HELP_TOPICS`. The shim `@/constants/helpContent` re-exports all + a defaulted `searchHelpTopics`.

- [ ] **Step 1: Write the failing engine test**

Create `mobile/__tests__/help/engine.test.ts` (imports ONLY from `@/help` — proves the engine stands alone):
```ts
import { blockText, searchHelpTopics, uncoveredFeatures, type HelpTopic } from "@/help";

const topics: HelpTopic[] = [
  { id: "a", title: "Reading", keywords: ["scroll"], blocks: [{ kind: "text", text: "open a book" }], featureKey: "reading" },
  { id: "b", title: "Glossary", keywords: [], blocks: [{ kind: "defs", defs: [{ term: "BYOK", def: "bring your own key" }] }] },
];

it("blockText flattens visible text", () => {
  expect(blockText(topics[0].blocks)).toBe("open a book");
  expect(blockText(topics[1].blocks)).toContain("BYOK");
});

it("searchHelpTopics matches title, keyword, and block text (case-insensitive)", () => {
  expect(searchHelpTopics("reading", topics).map((t) => t.id)).toEqual(["a"]);
  expect(searchHelpTopics("SCROLL", topics).map((t) => t.id)).toEqual(["a"]);
  expect(searchHelpTopics("byok", topics).map((t) => t.id)).toEqual(["b"]);
  expect(searchHelpTopics("", topics)).toHaveLength(2); // empty query → all
});

it("uncoveredFeatures reports features with no covering topic", () => {
  expect(uncoveredFeatures([{ key: "reading" }, { key: "sharing" }], topics)).toEqual(["sharing"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `mobile/`): `npx jest __tests__/help/engine.test.ts`
Expected: FAIL — `@/help` module not found.

- [ ] **Step 3: Create the engine modules**

`mobile/src/help/schema.ts`:
```ts
// Product-agnostic Help schema (future wegofwd-help). href/step/featureKey are
// plain strings — the consuming app owns route/step/feature validity.
export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: string[] }
  | { kind: "link"; label: string; href: string }
  | { kind: "defs"; defs: { term: string; def: string }[] }
  | { kind: "action"; label: string; step: string };

export interface HelpTopic {
  id: string;
  title: string;
  keywords: string[];
  blocks: HelpBlock[];
  featureKey?: string;
}
```

`mobile/src/help/search.ts`:
```ts
import type { HelpBlock, HelpTopic } from "./schema";

// Flatten a topic's visible text for indexing/search.
export function blockText(blocks: HelpBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "text":
          return b.text;
        case "steps":
          return b.steps.join(" ");
        case "link":
          return b.label;
        case "defs":
          return b.defs.map((d) => `${d.term} ${d.def}`).join(" ");
        case "action":
          return b.label;
      }
    })
    .join(" ");
}

// Case-insensitive search over title + keywords + visible text. Empty query
// returns all topics. No default `topics` — the engine holds no content.
export function searchHelpTopics(query: string, topics: HelpTopic[]): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  return topics.filter((t) =>
    `${t.title} ${t.keywords.join(" ")} ${blockText(t.blocks)}`.toLowerCase().includes(q),
  );
}
```

`mobile/src/help/coverage.ts`:
```ts
// Feature keys with no covering topic. Loose param types so a synthetic FEATURES
// list can be passed in tests.
export function uncoveredFeatures(
  features: readonly { key: string }[],
  topics: readonly { featureKey?: string }[],
): string[] {
  const covered = new Set(topics.map((t) => t.featureKey).filter((k): k is string => Boolean(k)));
  return features.map((f) => f.key).filter((k) => !covered.has(k));
}
```

`mobile/src/help/index.ts`:
```ts
// wegofwd-help (in-repo). Extraction injection points when this becomes a package:
// the render components (Task 2) import `@/constants/theme` (tokens) and
// `expo-router` (HelpButton nav) — parameterize those on extraction. See
// docs/superpowers/specs/2026-07-06-help-engine-seam-design.md.
export type { HelpBlock, HelpTopic } from "./schema";
export { blockText, searchHelpTopics } from "./search";
export { uncoveredFeatures } from "./coverage";
```

- [ ] **Step 4: Create the content pack**

`mobile/src/help-content/features.ts`:
```ts
// The user-facing features that MUST have in-app help (coverage gate). Adding a
// feature here requires a topic with the matching featureKey (see
// __tests__/help/coverage.test.ts).
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
```

`mobile/src/help-content/providerDefs.ts`:
```ts
import { PROVIDERS } from "@/constants/providers";
import { COST_LABEL, PROVIDER_GUIDES } from "@/constants/providerGuides";

// One "where to get a key" line per provider, derived from the provider guides
// so the help page can't drift from the in-wizard guidance.
export function providerKeyDefs(): { term: string; def: string }[] {
  return PROVIDERS.flatMap((p) => {
    const g = PROVIDER_GUIDES[p.id];
    if (!g) return [];
    return [
      {
        term: p.label,
        def: `${COST_LABEL[g.cost]}. Get a key at ${g.consoleLabel} (key looks like ${p.keyHint}).`,
      },
    ];
  });
}
```

`mobile/src/help-content/topics.ts`: **move the `HELP_TOPICS` array verbatim** from `mobile/src/constants/helpContent.ts` (lines 100→end). Prepend these imports and change nothing else in the array body:
```ts
import type { HelpTopic } from "@/help";
import { providerKeyDefs } from "./providerDefs";

export const HELP_TOPICS: HelpTopic[] = [
  /* …the exact existing array, unchanged… */
];
```
(The topics reference `providerKeyDefs()` in the `provider-keys` topic — that call now resolves to the local import.)

`mobile/src/help-content/index.ts`:
```ts
export { FEATURES, type FeatureKey } from "./features";
export { HELP_TOPICS } from "./topics";
```

- [ ] **Step 5: Turn `constants/helpContent.ts` into a compat shim**

Replace the entire contents of `mobile/src/constants/helpContent.ts` with (TEMP — deleted in Task 3; re-adds the defaulted `searchHelpTopics` so unchanged callers keep working):
```ts
// TEMP compatibility shim (Help engine/content seam). Re-exports the engine
// (@/help) + content (@/help-content) so existing imports keep working while the
// seam lands. Deleted in Task 3.
import { searchHelpTopics as _search, type HelpTopic } from "@/help";
import { HELP_TOPICS } from "@/help-content";

export type { HelpBlock, HelpTopic } from "@/help";
export { blockText, uncoveredFeatures } from "@/help";
export { FEATURES, type FeatureKey } from "@/help-content";
export { HELP_TOPICS } from "@/help-content";

// Preserve the original default-arg behaviour for callers that pass only a query.
export function searchHelpTopics(query: string, topics: HelpTopic[] = HELP_TOPICS): HelpTopic[] {
  return _search(query, topics);
}
```

- [ ] **Step 6: Run engine test + full suite + typecheck**

Run: `npx jest __tests__/help/engine.test.ts` → PASS (3).
Run: `npx jest` → full suite green (help.tsx + coverage test still use the shim, unchanged). `npm run typecheck` → clean. `npx eslint src/help src/help-content src/constants/helpContent.ts` → no errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/help mobile/src/help-content mobile/src/constants/helpContent.ts mobile/__tests__/help/engine.test.ts
git commit -m "refactor(help): extract help engine + content modules (compat shim in place)"
```

---

### Task 2: Engine components + thin Help screen

**Files:**
- Create: `mobile/src/help/components/{HelpButton.tsx,HelpHint.tsx,HelpTopicView.tsx}`
- Modify: `mobile/src/help/index.ts`, `mobile/app/(tabs)/help.tsx`, + the HelpButton/HelpHint import sites
- Delete: `mobile/src/components/HelpButton.tsx`, `mobile/src/components/HelpHint.tsx`

**Interfaces:**
- Consumes: `@/help` (schema + search from Task 1), `@/help-content` (`HELP_TOPICS`).
- Produces: `@/help` also exports `HelpButton`, `HelpHint`, `HelpTopicView` (props `{ topic: HelpTopic; onLink: (href: string) => void; onAction: (step: string) => void; highlighted?: boolean }`).

- [ ] **Step 1: Move HelpButton + HelpHint into the engine**

`git mv mobile/src/components/HelpButton.tsx mobile/src/help/components/HelpButton.tsx` and `git mv mobile/src/components/HelpHint.tsx mobile/src/help/components/HelpHint.tsx`. Fix any relative imports inside them (they import `@/constants/theme` and `expo-router` via path aliases — those are unchanged, so no edits needed).

- [ ] **Step 2: Extract the block/topic renderer into `HelpTopicView`**

Create `mobile/src/help/components/HelpTopicView.tsx` by moving the `Block` + `Step` components (and their `styles`) out of `app/(tabs)/help.tsx`. Change the block-renderer prop types to the generic engine types and export a `HelpTopicView` that renders one topic's blocks:
```tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HelpBlock, HelpTopic } from "@/help";
import { colors, radius, spacing, typography } from "@/constants/theme";

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepNum}>{n}</Text>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function Block({ block, onLink, onAction }: { block: HelpBlock; onLink: (href: string) => void; onAction: (step: string) => void }) {
  switch (block.kind) {
    case "text":
      return <Text style={styles.body}>{block.text}</Text>;
    case "steps":
      return <>{block.steps.map((s, i) => <Step key={i} n={i + 1} text={s} />)}</>;
    case "link":
      return (
        <Pressable style={styles.linkBtn} onPress={() => onLink(block.href)} accessibilityRole="button" accessibilityLabel={block.label}>
          <Text style={styles.linkBtnText}>{block.label}</Text>
        </Pressable>
      );
    case "defs":
      return (
        <>
          {block.defs.map((d, i) => (
            <View key={i} style={styles.def}>
              <Text style={styles.defTerm}>{d.term}</Text>
              <Text style={styles.defText}>{d.def}</Text>
            </View>
          ))}
        </>
      );
    case "action":
      return (
        <Pressable style={styles.actionBtn} onPress={() => onAction(block.step)} accessibilityRole="button" accessibilityLabel={block.label}>
          <Text style={styles.actionBtnText}>{block.label}</Text>
        </Pressable>
      );
  }
}

export function HelpTopicView({
  topic,
  onLink,
  onAction,
}: {
  topic: HelpTopic;
  onLink: (href: string) => void;
  onAction: (step: string) => void;
}): React.JSX.Element {
  return (
    <>
      {topic.blocks.map((b, i) => (
        <Block key={i} block={b} onLink={onLink} onAction={onAction} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  // Move the Block/Step-related style entries verbatim from app/(tabs)/help.tsx:
  //   body, step, stepNum, stepText, linkBtn, linkBtnText, def, defTerm, defText,
  //   actionBtn, actionBtnText.
  body: { fontSize: typography.sizeSm, color: colors.text, lineHeight: 22 },
  step: { flexDirection: "row", gap: spacing.sm, marginVertical: 2 },
  stepNum: { fontVariant: ["tabular-nums"], fontWeight: "700", color: colors.primary, width: 20 },
  stepText: { flex: 1, fontSize: typography.sizeSm, color: colors.text },
  linkBtn: { alignSelf: "flex-start", marginTop: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceHigh },
  linkBtnText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
  def: { marginVertical: 4 },
  defTerm: { fontWeight: "700", color: colors.text, fontSize: typography.sizeSm },
  defText: { color: colors.textSecondary, fontSize: typography.sizeSm },
  actionBtn: { alignSelf: "flex-start", marginTop: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary },
  actionBtnText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
});
```
**Important:** copy the *actual* style values for these keys from the current `app/(tabs)/help.tsx` `StyleSheet` (the values above mirror the existing look but the real file is the source of truth — use its exact numbers/colours). Leave the screen-level styles (`scroll`, `scrollContent`, `title`, `search`, `empty`, `section`, `sectionLabel`, `card`, `cardHighlight`) in `help.tsx`.

- [ ] **Step 3: Export the components from the engine**

Add to `mobile/src/help/index.ts`:
```ts
export { HelpButton } from "./components/HelpButton";
export { HelpHint } from "./components/HelpHint";
export { HelpTopicView } from "./components/HelpTopicView";
```

- [ ] **Step 4: Make `help.tsx` a thin screen**

In `mobile/app/(tabs)/help.tsx`: remove the local `Block`/`Step` + their styles; import from the engine + content; pass explicit topics; cast at the app boundary:
```tsx
import { searchHelpTopics, HelpTopicView } from "@/help";
import { HELP_TOPICS } from "@/help-content";
import { relaunchStep, type StepId } from "@/onboarding/firstRunState";
import type { Href } from "expo-router";
// …
const topics = useMemo(() => searchHelpTopics(query, HELP_TOPICS), [query]);
// …inside topics.map((t) => …), replace the inline <View style={styles.card}> block body with:
  <View style={[styles.card, highlight === t.id && styles.cardHighlight]}>
    <HelpTopicView
      topic={t}
      onLink={(href) => router.push(href as Href)}
      onAction={(step) => void relaunchStep(step as StepId)}
    />
  </View>
```
(The `as Href` / `as StepId` casts are where the app re-asserts route/step validity that the generic engine schema dropped.)

- [ ] **Step 5: Repoint HelpButton/HelpHint imports across the app**

Update these files' imports from `@/components/HelpButton` / `@/components/HelpHint` → `@/help`:
`app/(tabs)/settings.tsx`, `app/(tabs)/books.tsx`, `app/book/saved/[id].tsx`, `app/book/read/[id].tsx`, `app/book/generate/[id].tsx`, `app/sign-in.tsx`, `app/account.tsx`, `src/onboarding/WizardScaffold.tsx`, `src/components/GenerationParamsEditor.tsx`, `src/components/ProviderKeyForm.tsx`. (Change only the import specifier, e.g. `import { HelpButton } from "@/help";`.)

- [ ] **Step 6: Run full suite + typecheck + lint**

Run: `npx jest` → full suite green (behaviour unchanged). `npm run typecheck` → clean. `npx eslint "app/(tabs)/help.tsx" src/help/components` → no errors.

- [ ] **Step 7: Commit**

```bash
git add -A mobile/src/help mobile/app/\(tabs\)/help.tsx mobile/src/components mobile/app mobile/src/onboarding
git commit -m "refactor(help): move HelpButton/HelpHint + block renderer into the engine; thin Help screen"
```

---

### Task 3: Repoint the coverage test + delete the shim

**Files:**
- Modify: `mobile/__tests__/help/coverage.test.ts`
- Delete: `mobile/src/constants/helpContent.ts`

**Interfaces:** consumes `@/help` (`uncoveredFeatures`) + `@/help-content` (`FEATURES`, `HELP_TOPICS`).

- [ ] **Step 1: Repoint the coverage test imports**

In `mobile/__tests__/help/coverage.test.ts`, change the import line from `@/constants/helpContent` to:
```ts
import { uncoveredFeatures } from "@/help";
import { FEATURES, HELP_TOPICS } from "@/help-content";
```
(The three assertions are unchanged.)

- [ ] **Step 2: Verify nothing else imports the shim**

Run: `grep -rn "@/constants/helpContent" mobile/app mobile/src mobile/__tests__`
Expected: **no matches**. (If any remain, repoint them: types/search → `@/help`, FEATURES/HELP_TOPICS → `@/help-content`.)

- [ ] **Step 3: Delete the shim**

```bash
git rm mobile/src/constants/helpContent.ts
```

- [ ] **Step 4: Full suite + typecheck + lint**

Run: `npx jest` → full suite green (still **405** — no tests removed; engine.test added in Task 1, coverage test repointed). `npm run typecheck` → clean. `npx eslint mobile/src/help mobile/src/help-content "mobile/app/(tabs)/help.tsx"` → no errors.

- [ ] **Step 5: Commit**

```bash
git add -A mobile/__tests__/help/coverage.test.ts mobile/src/constants
git commit -m "refactor(help): repoint coverage test + delete the compat shim"
```

---

## Self-Review

**Spec coverage:**
- Engine `src/help/{schema,search,coverage,index}` + generic schema (href/step/featureKey → string) → Task 1. ✔
- Content `src/help-content/{features,providerDefs,topics,index}` → Task 1. ✔
- `searchHelpTopics` no default in engine; shim re-adds it → Task 1 Steps 3, 5. ✔
- Engine components (`HelpButton`/`HelpHint`) + `HelpTopicView` extraction + thin screen with `onLink`/`onAction` casts → Task 2. ✔
- Repoint ~11 import sites → Task 2 Step 5. ✔
- Delete shim + old component files → Task 2 Step 1 (git mv removes old component paths) + Task 3 Step 3. ✔
- Coverage gate survives from new locations → Task 3 Step 1. ✔
- Engine unit test importing only `@/help` → Task 1 Step 1. ✔
- Extraction-readiness comment (theme/router injection points) → Task 1 Step 3 (`index.ts`). ✔
- Zero user-facing change; suite green each task → Steps 6/6/4. ✔

**Placeholder scan:** none — full code for the new engine/content/shim/test/HelpTopicView; verbatim-move instructions (HELP_TOPICS array, HelpButton/HelpHint files, the exact Block/Step style values) point at the real source with explicit "use its exact values" notes rather than inventing content. ✔

**Type consistency:** engine `HelpBlock`/`HelpTopic` (string href/step/featureKey) ↔ `HelpTopicView` props (`onLink(href:string)`/`onAction(step:string)`) ↔ help.tsx casts (`as Href`/`as StepId`); `searchHelpTopics(query, topics)` (no default) consistent between engine + explicit call in help.tsx; `uncoveredFeatures` loose types unchanged; content `FEATURES`/`FeatureKey`/`HELP_TOPICS` exported from `@/help-content`, consumed by the coverage test. ✔
