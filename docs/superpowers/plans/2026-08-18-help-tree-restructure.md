# Help Tree Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, ~29-topic Help screen with a collapsible accordion tree (`HELP_TREE`), fully author the Projects subtree, drop the nav-hidden Shelves cluster, and fix stale "Studio"/"five places" copy — without breaking the coverage gate or any existing Help test.

**Architecture:** Decouple *structure* from *content*. `HelpTopic` (`mobile/src/help/schema.ts`) is untouched — it stays the unit of content and the unit the coverage gate counts. A new, separate `HelpTreeNode` type (also in `schema.ts`) describes navigation structure only, referencing topics by id. `HELP_TREE: HelpTreeNode[]` (new `mobile/src/help-content/tree.ts`) is authored independently of `HELP_TOPICS` (`mobile/src/help-content/topics.ts`). Two new engine-side traversal helpers (`mobile/src/help/tree.ts`: `flattenNodes`, `ancestorIdsForTopic`) let `mobile/app/(tabs)/help.tsx` render `HELP_TREE` as a recursive accordion and resolve a `?topic=<id>` deep link to its ancestor branches. Content work (dropping/fixing/authoring topics) lands first so the tree in Task 3 references topics that already exist.

**Tech Stack:** React Native + Expo Router, TypeScript, Jest + `@testing-library/react-native` (jest-expo preset, `moduleNameMapper` `^@/(.*)$` → `mobile/src/$1`).

**Spec:** `docs/superpowers/specs/2026-08-18-help-tree-restructure-design.md` (D1 accordion tree, D2 drop Shelves cluster, D3 restructure + fix stale + full Project detail; coverage-preservation rule; topic → tree-leaf mapping table).

## Global Constraints

- `HelpTopic` shape stays UNCHANGED (`id, title, keywords[], blocks[], featureKey?`) — only ADD `HelpTreeNode` to `mobile/src/help/schema.ts`. Block authoring uses the existing typed blocks (`text`/`steps`/`link`/`defs`/`action`) — no markdown block type.
- Coverage gate (`mobile/__tests__/help/coverage.test.ts`) stays green at EVERY task boundary. Never add a `FEATURES` key without its covering topic landing in the same task. Never delete a topic while its key remains (or vice versa). Drop the 3 Shelves-cluster topics + their 3 keys together (`open-shelves`, `imported-books`, `chapter-quiz`).
- No valid `featureKey` loses its topic — rewrite + re-home existing topics, never delete a non-dropped one. New keys added: `project-structure`, `project-drafts`, `project-publish`, each with its own new topic in the same task.
- One component (`mobile/app/(tabs)/help.tsx`) drives web + native — no `.web` variant, no drill-down routing. Search (`searchHelpTopics`) and the `?topic=<id>` deep-link (expand ancestor branches + scroll/highlight) both keep working.
- Use the exact on-screen labels from the UI map: nav tabs are Library · Projects · Reviews · Publish · Settings · Help · About (`mobile/src/components/navItems.ts` `NAV_ORDER` — `shelves` and `books`/"Studio" are never in it, hidden but still routed). Project detail tabs are Input · Structure · Drafts · Feedback · Publish.
- **Every task leaves `cd mobile && npx jest help` green** (matches all 7 pre-existing Help-related test files by case-insensitive `testPathPattern`: `__tests__/help/coverage.test.ts`, `__tests__/help/engine.test.ts`, `__tests__/help/starter-claim.test.ts`, `__tests__/help/reading-quiz.test.ts`, `__tests__/help/HelpHint.test.tsx`, `__tests__/help-content/topics.test.ts`, `__tests__/screens/Help.test.tsx`), plus `npx tsc --noEmit`.
- **Judgment calls made while researching this plan (flagged, not silently decided):**
  1. The spec's D3 tree layout (section "Content — the tree") never places `scoped-generation`, `diagram-types`, or `formats` — but they are not in the DROPPED list either, so the coverage-preservation rule requires they stay reachable. They are cross-cutting CONCEPTS (how scoping shapes a draft, diagram kinds, output formats) that apply wherever content is generated (incl. Projects › Drafts). Task 3 places them in a neutral top-level **"How generation works"** concepts branch — deliberately NOT naming the nav-hidden Studio tab (per D2), unlike the visible Posts/Publish tab which "Share & short-form" documents.
  2. `mobile/__tests__/help/starter-claim.test.ts` asserts that whenever `STARTER_SOURCES` (`mobile/src/openshelves/starterSources.ts`, currently 4 entries) is non-empty, **some** `HELP_TOPICS` entry must affirmatively promise curated/starter sources (regex `/starter/i`, `/curated by us/i`, `/we curate/i`) — today only the `open-shelves` topic satisfies that. Deleting `open-shelves` per D2 without touching this test would break it (a real regression the spec doesn't mention). Task 1 updates this test's invariant to also require the Shelves tab be nav-reachable (`NAV_ORDER.includes("shelves")`) before demanding a promise — preserving the original regression guard for if/when Shelves becomes nav-visible again, while making today's zero-promisers state correct.

---

### Task 1: Drop the Shelves cluster + fix stale "Studio"/"five places" copy

**Files:**
- Modify: `mobile/src/help-content/topics.ts:111-134` (reading-a-book topic)
- Modify: `mobile/src/help-content/topics.ts:216-246` (share-a-draft topic)
- Modify: `mobile/src/help-content/topics.ts:343-451` (delete open-shelves/imported-books/chapter-quiz topics)
- Modify: `mobile/src/help-content/features.ts:4-31` (remove 3 FEATURES keys)
- Modify: `mobile/__tests__/help/starter-claim.test.ts` (gate the curation-claim invariant on nav-reachability)
- Create: `mobile/__tests__/help/content.test.ts`

**Interfaces:**
- Consumes: `HELP_TOPICS` (`mobile/src/help-content/topics.ts`), `FEATURES` (`mobile/src/help-content/features.ts`), `uncoveredFeatures` (`mobile/src/help`), `NAV_ORDER` (`mobile/src/components/navItems.ts`), `STARTER_SOURCES` (`mobile/src/openshelves/starterSources.ts`).
- Produces: `HELP_TOPICS` with 26 entries (29 minus the 3 dropped); `FEATURES` with 23 entries (26 minus the 3 dropped). Both consumed by Task 2 (which adds 3 new topics + 3 new keys back, netting 29/26) and Task 3 (`HELP_TREE` references topic ids by string, so it doesn't care about array order or count directly, only that every id it references exists).

- [ ] **Step 1: Verify the chapter-quiz discovery nudge does not deep-link to Help (no repoint needed)**

Run: `grep -rn 'topic=.*chapter-quiz\|chapter-quiz.*topic=\|useNudge("chapter-quiz")\|nudge-chapter-quiz' mobile/app mobile/src --include=*.tsx --include=*.ts`

Expected: only `mobile/app/book/chapter/[bookId]/[chapterId].tsx:38` (`useNudge("chapter-quiz")`) and `:99` (`testID="nudge-chapter-quiz"`), plus the `src/discovery/__tests__/*` files exercising the nudge id. `DiscoveryNudge`'s `onDismiss={quizNudge.dismiss}` and the screen's own `handleMakeQuiz` are the nudge's only wiring — it never calls `router.push({ pathname: "/help", params: { topic: "chapter-quiz" } })`. This confirms dropping the `chapter-quiz` Help topic is safe with no code change to the nudge.

- [ ] **Step 2: Write the failing content-integrity test**

Create `mobile/__tests__/help/content.test.ts`:

```ts
import { HELP_TOPICS } from "@/help-content";

describe("help content — nav-hidden Shelves cluster is not documented", () => {
  it("does not include the dropped Shelves-cluster topics", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).not.toContain("open-shelves");
    expect(ids).not.toContain("imported-books");
    expect(ids).not.toContain("chapter-quiz");
  });
});

describe("help content — stale 'Studio' nav copy is fixed", () => {
  it("reading-a-book does not name Studio as a live nav tab or say 'five places'", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "reading-a-book")!;
    const text = topic.blocks
      .map((b) => ("text" in b ? b.text : ""))
      .join(" ");
    expect(text).not.toMatch(/Studio \(create and edit books\)/);
    expect(text).not.toMatch(/five places/);
  });

  it("share-a-draft does not point reviewers at a Studio badge", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "share-a-draft")!;
    const steps = topic.blocks.flatMap((b) => ("steps" in b ? b.steps : []));
    expect(steps.join(" ")).not.toMatch(/badge appears on the book in Studio/);
  });
});
```

- [ ] **Step 3: Run the new test and confirm it fails**

Run: `cd mobile && npx jest __tests__/help/content.test.ts`
Expected: FAIL — `Cannot find module '@/help-content'` resolves fine, but the two "stale copy" assertions fail because the live text still says "Studio (create and edit books)", "five places", and "badge appears on the book in Studio".

- [ ] **Step 4: Fix the reading-a-book stale nav sentence**

In `mobile/src/help-content/topics.ts`, replace:

```ts
      {
        kind: "text",
        text: "Mentible has five places along the top of the app: Library (your finished books), Studio (create and edit books), Settings (your LLM keys and preferences), Help (guides and these walkthroughs), and About (version and privacy).",
      },
```

with:

```ts
      {
        kind: "text",
        text: "Mentible's nav bar has: Library (your finished books), Projects (the expert-validation studio), Reviews (projects you've been invited to review), Publish (turn your writing into posts and shareable cards), Settings (your LLM keys and preferences), Help (guides and these walkthroughs), and About (version and privacy).",
      },
```

(The rest of the `reading-a-book` topic — the steps block and the quiz paragraph checked by `mobile/__tests__/help/reading-quiz.test.ts` — is untouched.)

- [ ] **Step 5: Fix the share-a-draft stale Studio-badge step**

In `mobile/src/help-content/topics.ts`, replace:

```ts
          "When they comment, a 💬 badge appears on the book in Studio — tap it to read their comments and reply.",
```

with:

```ts
          "When they comment, a 💬 badge appears on the book's card in your Library — tap it to read their comments and reply.",
```

- [ ] **Step 6: Run the content test again — the stale-copy assertions now pass, the removal assertion still fails**

Run: `cd mobile && npx jest __tests__/help/content.test.ts`
Expected: the "stale 'Studio' nav copy is fixed" describe block passes; "does not include the dropped Shelves-cluster topics" still FAILS (the 3 topics are still in the array).

- [ ] **Step 7: Remove the 3 FEATURES keys first, and watch the coverage gate go red**

In `mobile/src/help-content/features.ts`, delete these three lines from the `FEATURES` array:

```ts
  { key: "open-shelves", label: "Open Shelves (free book repos)" },
  { key: "imported-books", label: "Reading imported books" },
  { key: "chapter-quiz", label: "Chapter quiz (imported books)" },
```

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: FAIL on `it("no topic references a featureKey that isn't in FEATURES")` — `orphans` now equals `["open-shelves", "imported-books", "chapter-quiz"]` (the three topics still carry those `featureKey`s, but the keys no longer exist in `FEATURES`). This is the expected red step demonstrating the topic↔key coupling.

- [ ] **Step 8: Remove the 3 topic objects, restoring green**

In `mobile/src/help-content/topics.ts`, delete the three consecutive topic objects (`open-shelves`, `imported-books`, `chapter-quiz`) in full:

```ts
  {
    id: "open-shelves",
    title: "Add & manage free book repos (Open Shelves)",
    featureKey: "open-shelves",
    keywords: [
      "open shelves", "shelves", "opds", "catalog", "repo", "repository",
      "source", "free books", "add source", "refresh", "remove",
      "download", "downloads", "offline", "storage", "delete download",
    ],
    blocks: [
      {
        kind: "text",
        text: "Open Shelves lets you add free book catalogs (OPDS feeds), then browse and manage them from the Shelves tab. A few starter libraries — Project Gutenberg shelves, curated by us — come included, so you always have somewhere to start. You can also add your own: paste an OPDS catalog URL.",
      },
      {
        kind: "steps",
        steps: [
          "Open the Shelves tab and enter an OPDS catalog URL, then tap Add.",
          "Confirm the warning — user-added sources are outside Mentible's curation, and you're responsible for what you add and read.",
          "Tap a source to refresh it and pick up new entries, or use Refresh all to refresh every source at once.",
          "Remove a source you no longer want; its catalog entries are removed from this device.",
        ],
      },
      {
        kind: "defs",
        defs: [
          {
            term: "Is a source curated?",
            def: "The starter shelves (Project Gutenberg) are curated by us. Any source you add yourself is outside Mentible's curation and is your responsibility — we don't vet or moderate third-party feeds.",
          },
          {
            term: "Authenticated repos",
            def: "Catalogs that require sign-in aren't supported yet — add public, no-auth OPDS catalogs.",
          },
          {
            term: "Downloading for offline reading",
            def: "Open an entry and tap Download. The file is fetched straight from the source library to your device — it never passes through Mentible. Books and audio can be downloaded; video is streaming-only. See everything you've saved, its size, and delete individual items (or all of them) under Downloads on the Shelves tab.",
          },
          {
            term: "Where downloads live",
            def: "Downloads are stored on this device only — they're never uploaded, synced, or tied to your account, so a download exists only where you made it. On the web app, Download hands the file to your browser instead, and it is not stored in the app for offline reading.",
          },
          {
            term: "Catalogs on the web app",
            def: "In a browser, Mentible asks its own server to fetch the catalog listing, because browsers block sites from reading most catalogs directly. Only the listing goes through us — the book itself always downloads straight from the library to you.",
          },
        ],
      },
      { kind: "link", label: "Open Shelves →", href: "/shelves" },
    ],
  },
  {
    id: "imported-books",
    title: "Reading a book you imported",
    featureKey: "imported-books",
    keywords: ["epub", "import", "open", "downloaded", "shelves", "read"],
    blocks: [
      {
        kind: "text",
        text: "A book you download from Open Shelves can be opened and read inside Mentible. Tap Open on the Downloads screen and it joins your Library. On the web app, use \"Import an EPUB\" and pick the file you downloaded — browsers don't let us read it for you.",
      },
      {
        kind: "steps",
        steps: [
          "Download a book from a catalog on the Shelves tab.",
          "Open Downloads and tap Open next to the book.",
          "The book appears in your Library and opens in the reader.",
        ],
      },
      {
        kind: "defs",
        defs: [
          { term: "Does the book leave my device?", def: "No. It's unzipped and stored on this device. Opening a book makes no network request — pictures inside the book are read from the book itself, and anything it tries to load from the internet is dropped." },
          { term: "Why doesn't it look like the original?", def: "We render the book's text in Mentible's own typography and drop the book's styling. Its pictures are kept." },
          { term: "Copy-protected books", def: "Books with DRM can't be opened here, and Mentible will say so rather than showing you a broken book." },
        ],
      },
    ],
  },
  {
    id: "chapter-quiz",
    title: "Make a quiz from an imported chapter",
    featureKey: "chapter-quiz",
    keywords: ["quiz", "chapter quiz", "imported", "open shelves", "test", "questions"],
    blocks: [
      {
        kind: "text",
        text: "While reading a chapter of an imported book, tap \"Make a quiz from this chapter\" to generate an interactive multiple-choice quiz grounded in that chapter's own text — questions are answerable only from what the chapter says, not from outside knowledge. It's the reason to import a book into Mentible instead of just reading it in any EPUB app.",
      },
      {
        kind: "steps",
        steps: [
          "Open a chapter of an imported book.",
          "Tap \"Make a quiz from this chapter\" below the text.",
          "Wait for generation to finish (it uses your LLM key, like any other generation).",
          "Read the questions right in the reader. Tap an option to answer, and the correct answer is highlighted with an explanation.",
        ],
      },
      {
        kind: "defs",
        defs: [
          { term: "Does this cost tokens?", def: "Yes — it's a real generation against your configured provider, same as generating a topic." },
          { term: "Long chapters", def: "Very long chapters are capped before being sent to the model; when that happens the screen shows a hint that the quiz only covers the first part." },
          { term: "Does it change the chapter?", def: "No. The chapter's text is never edited — the quiz is stored separately and only ever added to." },
          { term: "Where is it available?", def: "On both the web app and the Android app (not in the demo build, which has no backend). Tapping an option to reveal the answer works in both readers." },
        ],
      },
    ],
  },
```

Delete all three objects (there is nothing between them but their own closing `},` — removing this whole span leaves `attach-figures`'s closing `},` directly followed by `projects`'s opening `{`, which stays valid array syntax).

- [ ] **Step 9: Fix the starter-claim invariant to account for Shelves being nav-hidden**

`mobile/__tests__/help/starter-claim.test.ts` currently asserts (lines 40-51):

```ts
describe("help's curation claim tracks the starter-source capability", () => {
  it("promises curated/starter sources only when starter sources actually exist", () => {
    const promisers = HELP_TOPICS.filter(promisesCuration).map((t) => t.id);
    if (STARTER_SOURCES.length === 0) {
      // No capability → the copy must not promise one. This is the direction
      // that protects users, and the one that was violated.
      expect(promisers).toEqual([]);
    } else {
      // Capability shipped → the copy must say so, or nobody will find it.
      expect(promisers.length).toBeGreaterThan(0);
    }
  });
```

`STARTER_SOURCES` (`mobile/src/openshelves/starterSources.ts`) has 4 entries today, so this test currently requires at least one `HELP_TOPICS` entry to affirmatively promise curated/starter sources — satisfied today only by the `open-shelves` topic Step 8 just deleted. Left as-is, this test would go red the moment `open-shelves` is removed. Fix it to also require the Shelves tab be nav-reachable before demanding a promise (Shelves is intentionally undocumented while hidden — same reasoning as D2 for Help itself):

Replace the whole block above with:

```ts
describe("help's curation claim tracks the starter-source capability", () => {
  it("promises curated/starter sources only when the feature is both nav-reachable and populated", () => {
    const promisers = HELP_TOPICS.filter(promisesCuration).map((t) => t.id);
    const shelvesIsNavVisible = NAV_ORDER.includes("shelves");
    if (STARTER_SOURCES.length === 0 || !shelvesIsNavVisible) {
      // No capability, or the capability exists but is intentionally
      // undocumented while Shelves is hidden from the nav (Help Tree
      // Restructure, D2) → the copy must not promise one.
      expect(promisers).toEqual([]);
    } else {
      // Capability shipped AND reachable → the copy must say so, or nobody
      // will find it.
      expect(promisers.length).toBeGreaterThan(0);
    }
  });
```

And add the import at the top of the file, alongside the existing imports:

```ts
import { NAV_ORDER } from "@/components/navItems";
```

- [ ] **Step 10: Run the full Help suite and confirm green**

Run: `cd mobile && npx jest help`
Expected: PASS — all 7 files (`content.test.ts` new; `coverage.test.ts`, `starter-claim.test.ts`, `topics.test.ts`, `reading-quiz.test.ts`, `engine.test.ts`, `HelpHint.test.tsx`, `Help.test.tsx` untouched-or-fixed) all green. `topics.test.ts`'s `OFFLINE`→`troubleshooting` and `billing`→`provider-keys` search assertions, and the `getting-started` topic assertions, are all unaffected (none of those topics were touched). `reading-quiz.test.ts` still passes because only the first `text` block of `reading-a-book` changed — the quiz paragraph ("Quizzes inside a book are interactive: tap an option...") is untouched.

- [ ] **Step 11: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
cd mobile
git add src/help-content/topics.ts src/help-content/features.ts __tests__/help/content.test.ts __tests__/help/starter-claim.test.ts
git commit -m "$(cat <<'EOF'
feat(help): drop the nav-hidden Shelves cluster, fix stale Studio copy

Removes the open-shelves/imported-books/chapter-quiz Help topics and their
FEATURES keys together (Shelves is hidden from NAV_ORDER, routes stay
reachable but undocumented — Help Tree Restructure D2). Fixes reading-a-book
and share-a-draft, which still named a "Studio" nav tab hidden by d3f8495.
Updates starter-claim.test.ts's curation-promise invariant to also require
Shelves be nav-reachable, so it stays a real regression guard instead of a
false positive against the intentional removal.
EOF
)"
```

---

### Task 2: Author the Projects subtree (rewrite Overview/Input/Feedback, add Structure/Drafts/Publish)

**Files:**
- Modify: `mobile/src/help-content/features.ts` (add 3 keys: `project-structure`, `project-drafts`, `project-publish`)
- Modify: `mobile/src/help-content/topics.ts` (rewrite `projects`, `sources`, `reviews`, `draft-viewer`; add 3 new topics)
- Modify: `mobile/__tests__/help/content.test.ts` (add a describe block for the 3 new topics)

**Interfaces:**
- Consumes: `HELP_TOPICS`, `FEATURES` (same as Task 1, now with the Shelves cluster removed).
- Produces: `HELP_TOPICS` grows from 26 to 29 entries (adds `project-structure`, `project-drafts`, `project-publish`); `FEATURES` grows from 23 to 26 keys. Task 3's `HELP_TREE` references all three new topic ids by string — they must exist before Task 3 lands (which this task guarantees).

- [ ] **Step 1: Write the failing coverage-gate test for the 3 new keys**

In `mobile/src/help-content/features.ts`, add these three lines to the `FEATURES` array, right after the existing `grounding-report` entry:

```ts
  { key: "project-structure", label: "Building a project's outline (Structure)" },
  { key: "project-drafts", label: "Generating project drafts (Drafts)" },
  { key: "project-publish", label: "Publishing a project's validated work" },
```

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: FAIL on `it("every declared feature has at least one Help topic")` — `uncoveredFeatures(FEATURES, HELP_TOPICS)` now returns `["project-structure", "project-drafts", "project-publish"]` (red, expected: the keys exist but no topic carries them yet).

- [ ] **Step 2: Add the 3 new topics**

In `mobile/src/help-content/topics.ts`, insert these three new topic objects right after the existing `generate-full-book` topic (the last element in `HELP_TOPICS`), before the closing `];`:

```ts
  {
    id: "project-structure",
    title: "Structure — build the outline",
    featureKey: "project-structure",
    keywords: ["structure", "outline", "toc", "table of contents", "topic tree", "suggest from sources", "subject", "subtopic", "citation"],
    blocks: [
      {
        kind: "text",
        text: "The Structure tab is where a project's outline lives — subjects, broken into topics, broken into subtopics, each one optionally citing the source it comes from. It's the table of contents Drafts and Publish both work from.",
      },
      {
        kind: "text",
        text: "\"Suggest from sources\" asks the AI to draft an outline from your captured sources — it needs at least one source to work from, and is gated by the Free plan's usage cap. If the outline already has content, it asks you to confirm \"Replace outline?\" before overwriting it.",
      },
      {
        kind: "text",
        text: "You can also hand-edit the outline directly in the topic tree editor — add, rename, reorder or remove subjects, topics and subtopics. Every change auto-saves; there's no separate Save button.",
      },
      {
        kind: "text",
        text: "A Reviewer's Structure tab is read-only: they can see the outline but can't run \"Suggest from sources\" or edit the tree.",
      },
      {
        kind: "steps",
        steps: [
          "Add at least one source on the Input tab first.",
          "Open Structure and tap \"Suggest from sources\" for an AI-drafted outline, or build the tree by hand.",
          "Edit subjects, topics and subtopics directly in the tree — changes auto-save.",
          "Move to Drafts once the outline has the shape you want.",
        ],
      },
    ],
  },
  {
    id: "project-drafts",
    title: "Drafts — generate whole-book or per-topic content",
    featureKey: "project-drafts",
    keywords: ["drafts", "whole book", "per topic", "format", "linkedin", "x thread", "reel", "podcast", "essay", "chapter outline", "version", "compare", "diff", "status", "generate", "regenerate"],
    blocks: [
      {
        kind: "text",
        text: "Once an outline exists (built on Structure), the Drafts tab shows a Whole book / Per topic toggle.",
      },
      {
        kind: "text",
        text: "Whole book mode offers six format cards — LinkedIn post, X thread, Reel script, Podcast cold-open, Long-form essay, and Chapter outline. Picking one creates a fresh draft (version 1) in that format. \"Generate full book\" fans a full-length draft out over every topic in the outline that doesn't have one yet, as a background job with a token/cost estimate and a progress indicator — see \"Generate the whole book at once\" for the details.",
      },
      {
        kind: "text",
        text: "\"Your drafts\" lists every draft you've made, and opening one shows its version history (v1, v2, …) — tap View to read a version, or pick two to Compare and see a diff between them.",
      },
      {
        kind: "text",
        text: "Per topic mode lists every row of the outline with a status chip — Not generated, Drafted, or Validated — and, for the owner, Generate / Regenerate / Open buttons on each row. A Reviewer only sees View / Open; they can't generate.",
      },
      {
        kind: "steps",
        steps: [
          "Build an outline on Structure first.",
          "Choose Whole book or Per topic on the Drafts tab.",
          "Whole book: pick a format card to draft it, or Generate full book to draft every outline topic at once.",
          "Per topic: Generate (or Regenerate) each topic row, then Open to read it.",
        ],
      },
    ],
  },
  {
    id: "project-publish",
    title: "Publish — export and share validated work",
    featureKey: "project-publish",
    keywords: ["publish", "export", "download", "epub", "pdf", "word", "docx", "add to library", "copy", "markdown", "validated", "free", "pro", "upgrade", "provenance"],
    blocks: [
      {
        kind: "text",
        text: "The Publish tab is where a validated version leaves the project. It has the same Whole book / Per topic toggle as Drafts, and only shows validated content — what you publish is the version an expert stood behind. This is the project's own Publish tab, not the app's separate Publish (Posts) nav tab, which turns any of your writing into social posts, image cards, carousels and animated cards — see \"Share & short-form\" for that.",
      },
      {
        kind: "text",
        text: "For long-form assets (book, essay, guide), you get Add to Library (compiles it into an EPUB in your reader), Download EPUB, Download PDF, and — on a Pro plan — Download Word (.docx).",
      },
      {
        kind: "text",
        text: "For social assets (LinkedIn post, X thread, Reel script, Podcast cold-open), there's no compiled file — you get Copy and Copy as Markdown instead.",
      },
      {
        kind: "text",
        text: "In Per topic mode, \"Publish book\" assembles every validated topic draft into one book export (Add to Library / EPUB / PDF / Word) — it's gated until ALL topics in the outline are validated.",
      },
      {
        kind: "text",
        text: "Free plans can read everything here but see \"Upgrade to Pro to download\" instead of the download buttons. Validated content also carries a provenance chip — \"expert-validated\" or \"operator-recorded\" — so anyone reading the exported work can see how it was validated.",
      },
    ],
  },
```

- [ ] **Step 3: Run the coverage gate again — confirm green**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: PASS.

- [ ] **Step 4: Rewrite the `projects` topic (Overview)**

In `mobile/src/help-content/topics.ts`, replace the whole `projects` topic object:

```ts
  {
    id: "projects",
    title: "Create & set up a project",
    featureKey: "projects",
    keywords: ["project", "expert", "knowledge", "version", "invite", "capture", "create", "validate", "share", "journey", "publish", "export", "markdown"],
    blocks: [
      {
        kind: "text",
        text: "A project captures a piece of expert knowledge you want to write down, refine, and have validated by someone qualified. Create one from the Projects tab, add versions as your understanding improves, and invite an expert to review it once it's ready.",
      },
      {
        kind: "text",
        text: "Every project moves through four phases: capture your input, create a draft from it, have an expert validate it, then share it once it's ready. The project screen has a tab for each phase — Input, Drafts, Feedback, Publish — and opens on whichever one you're currently in, so you always know where a project stands. Tap any tab to jump to a different phase.",
      },
      {
        kind: "text",
        text: "Publish is the last phase: it lists each asset that has an expert-validated version and lets you Copy it as plain text or as Markdown, ready to paste wherever you need it. Only validated versions appear — so what you publish is the version an expert stood behind. For book and guide assets, Pro plans can also download EPUB, PDF, and Word.",
      },
      {
        kind: "steps",
        steps: [
          "On the Projects tab, tap \"+ New project\".",
          "Give it a title and, optionally, a topic, audience, and goal.",
          "Add a version once the project exists — this is the content the expert reviews.",
          "Invite an expert to review it from the project screen.",
        ],
      },
    ],
  },
```

with:

```ts
  {
    id: "projects",
    title: "What a project is — and how to start one",
    featureKey: "projects",
    keywords: ["project", "expert", "knowledge", "capture", "create", "validate", "share", "trust", "phase", "tab", "role", "owner", "reviewer", "editor", "banner"],
    blocks: [
      {
        kind: "text",
        text: "A project is Mentible's expert-validation studio: you capture an expert's raw knowledge, turn it into a draft, have an expert validate it, then share the validated result. \"Trust is the product\" — every project moves through the same four-phase loop: Capture → Create → Validate → Share.",
      },
      {
        kind: "text",
        text: "The project screen has five tabs, one per stage of that loop: Input (capture sources), Structure (build the outline), Drafts (generate content), Feedback (review & approve), and Publish (export the validated result). An adaptive banner at the top of the screen always tells you the single next thing to do, and the screen opens on whichever tab you're currently in — so you never have to guess where a project stands. Tap any tab to jump to a different phase; Back/Next at the bottom move you through them in order.",
      },
      {
        kind: "text",
        text: "Three roles work a project: the Owner (who created it) can edit sources, structure and drafts, and invite people; an invited Reviewer can approve, withdraw an approval, and comment, but can't edit; an invited Editor can also edit the draft and create new versions. Everyone with access sees the same project — the tabs just show or hide actions based on your role.",
      },
      {
        kind: "steps",
        steps: [
          "On the Projects tab, tap \"+ New project\".",
          "Fill in Title (required), and optionally Topic, Audience and Goal — these steer tone, not content.",
          "Add your source material on the Input tab.",
          "Follow the banner's next step through Structure, Drafts, Feedback and Publish.",
        ],
      },
    ],
  },
```

(`project-fields` is not being touched — its existing content already correctly names the Input tab and explains Title/Topic/Audience/Goal per the UI map; it's re-homed, not rewritten, in Task 3.)

- [ ] **Step 5: Expand the `sources` topic (Input tab)**

In `mobile/src/help-content/topics.ts`, replace the whole `sources` topic object:

```ts
  {
    id: "sources",
    title: "Sources — capture the expert's knowledge",
    featureKey: "sources",
    keywords: [
      "source",
      "sources",
      "capture",
      "transcript",
      "note",
      "link",
      "input",
      "material",
      "intake",
      "draft",
      "generate",
      "create",
    ],
    blocks: [
      {
        kind: "text",
        text: "Sources are the raw material a project is built from — an interview transcript, a note, or a link to something the expert wrote. Open a project and, as its owner, paste a source under the Input tab. Everyone invited to the project can see the sources behind the work. Adding sources is the first step; a later step turns them into a drafted, expert-reviewed asset.",
      },
      {
        kind: "text",
        text: "Once at least one source is captured, the project owner can Generate a draft. This turns the captured sources into a first version for the expert to review — grounded in, and attributed to, those sources.",
      },
    ],
  },
```

with:

```ts
  {
    id: "sources",
    title: "Input — capture the expert's sources",
    featureKey: "sources",
    keywords: [
      "source",
      "sources",
      "capture",
      "transcript",
      "note",
      "link",
      "input",
      "material",
      "intake",
      "add source",
      "edit",
      "delete",
      "cited",
      "guard",
    ],
    blocks: [
      {
        kind: "text",
        text: "Sources are the raw material a project is built from. On the Input tab, pick a kind — Transcript, Note, or Link — give it a short title, paste its content (or the URL for a Link), then tap \"Add source\" (it stays disabled until both fields have something in them). Add as many as you like; everyone invited to the project can see the full source list, though only the owner can add, edit or delete them.",
      },
      {
        kind: "text",
        text: "Tap a source row to expand it, where Edit and Delete sit. Once a source has been cited by a draft, editing its CONTENT is blocked — the draft's citation would otherwise point at text that no longer says what it said when it was cited. You can still edit its title or reference at any time; only the content is protected, and only once something cites it.",
      },
      {
        kind: "text",
        text: "A Reviewer's Input tab is read-only: they can read every source but can't add, edit or delete one.",
      },
      {
        kind: "text",
        text: "Once at least one source is captured, the owner can move on to Structure to build an outline, or straight to Drafts to generate a first version — either way, everything the model writes is grounded in, and attributed to, these sources.",
      },
      {
        kind: "steps",
        steps: [
          "Choose a source kind: Transcript, Note, or Link.",
          "Give it a Title (or Label) and paste its Content (or the URL).",
          "Tap \"Add source\" — it's disabled until both fields are filled in.",
          "Tap a source row to Edit or Delete it later.",
        ],
      },
    ],
  },
```

- [ ] **Step 6: Rewrite the `reviews` topic (the Reviews nav tab, distinct from Feedback)**

In `mobile/src/help-content/topics.ts`, replace the whole `reviews` topic object:

```ts
  {
    id: "reviews",
    title: "Review & approve a project",
    featureKey: "reviews",
    keywords: ["review", "approve", "expert", "validate"],
    blocks: [
      {
        kind: "text",
        text: "If an author invites you as a reviewer, their project appears on the Reviews tab. Open it to see its versions and mark the ones you've checked as validated, so the author knows an expert stands behind them.",
      },
      {
        kind: "steps",
        steps: [
          "Open the Reviews tab.",
          "Tap the project you were invited to.",
          "Approve a version once you've checked it.",
        ],
      },
    ],
  },
```

with:

```ts
  {
    id: "reviews",
    title: "The Reviews tab — your invited-project inbox",
    featureKey: "reviews",
    keywords: ["review", "reviews tab", "approve", "expert", "validate", "inbox", "invited"],
    blocks: [
      {
        kind: "text",
        text: "The Reviews tab is your inbox of projects other people have invited you into — it's separate from a project's own Feedback tab, which is where the actual approving happens once you're inside a project. Reviews just lists what's waiting for you.",
      },
      {
        kind: "text",
        text: "Open a project from here to land on its Feedback tab, where you read a draft, approve or request a revision. Approving there marks the version \"expert-validated\" under your name.",
      },
      {
        kind: "steps",
        steps: [
          "Open the Reviews tab to see every project you've been invited to.",
          "Tap a project to open it on its Feedback tab.",
          "Read the draft, then Approve it or Request a revision.",
        ],
      },
    ],
  },
```

- [ ] **Step 7: Rewrite the `draft-viewer` topic (Feedback tab detail)**

In `mobile/src/help-content/topics.ts`, replace the whole `draft-viewer` topic object:

```ts
  {
    id: "draft-viewer",
    title: "Read, copy, approve, request revisions, edit & regenerate a draft",
    featureKey: "draft-viewer",
    keywords: ["draft", "content", "read", "view", "copy", "clipboard", "approve", "unapprove", "withdraw", "feedback", "revision", "request", "note", "edit", "revise", "regenerate", "version", "guidance"],
    blocks: [
      {
        kind: "text",
        text: "Open a project, go to Drafts (or Feedback), and tap a version to read the full drafted content. From here you can Copy the whole draft to your clipboard, and Approve it (or Unapprove it) — the actions sit right on the draft you're reading.",
      },
      {
        kind: "text",
        text: "Approving records that the version is validated; Unapprove withdraws that approval and returns the version to \"awaiting review\". Both are kept as a record — unapproving doesn't erase the earlier approval, it appends a withdrawal — so a version's trust history stays intact.",
      },
      {
        kind: "text",
        text: "Under the draft, Revision notes is a running log for that version: a reviewer (or the owner) can Request a revision — a short note asking for a change — and every note stays attached to the version it was about. The owner then edits or regenerates to produce the next version in response.",
      },
      {
        kind: "text",
        text: "Owners can also edit or regenerate. Editing adjusts each section's heading and body; saving creates a new version. Regenerate re-drafts from the sources — you can add optional guidance (for example, \"focus on 2026 costs\"). Every edit or regeneration is a new version, so an earlier approved version is never changed; the new version needs its own approval.",
      },
    ],
  },
```

with:

```ts
  {
    id: "draft-viewer",
    title: "Feedback — read, approve, comment & revise a draft",
    featureKey: "draft-viewer",
    keywords: ["draft", "content", "read", "view", "copy", "clipboard", "approve", "unapprove", "withdraw", "feedback", "revision", "request", "note", "edit", "revise", "regenerate", "version", "guidance", "invite", "expert", "editor", "reviewer", "expert-validated", "operator-recorded", "comment"],
    blocks: [
      {
        kind: "text",
        text: "The Feedback tab (like Drafts) has a Whole book / Per topic toggle at the top — pick whichever matches how you're generating this project. Under it, a version list opens the draft viewer, where every action below lives.",
      },
      {
        kind: "text",
        text: "Open a version to read the full drafted content. From here you can Copy the whole draft to your clipboard, leave a Comment on a specific section, and Approve it (or Unapprove it) — the actions sit right on the draft you're reading.",
      },
      {
        kind: "text",
        text: "Approving records the version as validated. There are two ways it happens: a reviewer taps Approve themselves — that's recorded as \"expert-validated\" (self-approved by the invited expert). Or the owner taps Approve, names the expert who signed off outside the app, and taps \"Record approval\" — that's recorded as \"operator-recorded\" (the owner vouching for someone else's sign-off). Both show a provenance chip so anyone reading the project can see which happened. Unapprove withdraws an approval and returns the version to \"awaiting review\" — it appends a withdrawal rather than erasing the earlier approval, so the trust history stays intact.",
      },
      {
        kind: "text",
        text: "\"Invite an expert\" (owner-only) sends someone access to this one project by email: choose whether they join as a Reviewer (can approve, withdraw, and comment) or an Editor (can also edit the draft and create new versions), enter their email, and send. They gain access the next time they sign in with that email.",
      },
      {
        kind: "text",
        text: "Under the draft, Revision notes is a running, project-wide feedback log, newest first: a reviewer, editor, or the owner can \"Request a revision\" — a short note asking for a change — and every note stays attached to the version it was about.",
      },
      {
        kind: "text",
        text: "Owners (and invited Editors) can also edit or regenerate. Editing adjusts each section's heading and body; saving creates a new version. Regenerate re-drafts from the sources — you can add optional guidance (for example, \"focus on 2026 costs\"). Every edit or regeneration is a new version, so an earlier approved version is never changed; the new version needs its own approval. A \"Changes from v{n}\" diff and the full Versions history are available from the draft viewer too.",
      },
    ],
  },
```

(`grounding-report`, `generate-full-book`, `word-export`, and `kdp-export` are NOT changed in this task — their existing content already matches the UI map's Quality-report/whole-book/Word/KDP descriptions; they are re-homed, not rewritten, in Task 3.)

- [ ] **Step 8: Extend the content-integrity test with a regression guard for the 3 new topics**

In `mobile/__tests__/help/content.test.ts`, add a new describe block at the end of the file:

```ts

describe("help content — Projects subtree has the three new tab topics", () => {
  it("includes project-structure, project-drafts and project-publish", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["project-structure", "project-drafts", "project-publish"]),
    );
  });
});
```

- [ ] **Step 9: Run the full Help suite and confirm green**

Run: `cd mobile && npx jest help`
Expected: PASS. `topics.test.ts`'s `searchHelpTopics("billing", ...)` still contains `provider-keys` (untouched); `reading-quiz.test.ts` still passes (only Task 1 touched `reading-a-book`, and only its first block).

- [ ] **Step 10: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
cd mobile
git add src/help-content/topics.ts src/help-content/features.ts __tests__/help/content.test.ts
git commit -m "$(cat <<'EOF'
feat(help): author the full Projects subtree (Structure/Drafts/Publish + rewrites)

Adds project-structure/project-drafts/project-publish topics (+ FEATURES
keys) for the Structure/Drafts/Publish tabs, and rewrites projects (now the
5-tab Overview, was missing Structure entirely), sources (Input tab: source
kinds, Add-source disabled state, cited-source guard, reviewer read-only),
reviews (clarifies it's the invited-project inbox, distinct from a project's
own Feedback tab), and draft-viewer (adds the Whole/Per-topic toggle, Invite
an expert w/ Reviewer vs Editor roles, and expert-validated vs
operator-recorded provenance).
EOF
)"
```

---

### Task 3: Schema + tree data (`HelpTreeNode`, `HELP_TREE`, traversal helpers)

**Files:**
- Modify: `mobile/src/help/schema.ts` (add `HelpTreeNode`)
- Modify: `mobile/src/help/index.ts` (export `HelpTreeNode`, `flattenNodes`, `ancestorIdsForTopic`)
- Create: `mobile/src/help/tree.ts` (engine: `flattenNodes`, `ancestorIdsForTopic`)
- Create: `mobile/src/help-content/tree.ts` (content: `HELP_TREE`)
- Modify: `mobile/src/help-content/index.ts` (export `HELP_TREE`)
- Create: `mobile/__tests__/help/tree.test.ts`

**Interfaces:**
- Consumes: `HELP_TOPICS` (29 entries after Task 2) from `mobile/src/help-content/topics.ts`.
- Produces: `HelpTreeNode` type (`{ id: string; title: string; blurb?: string; topicId?: string; children?: HelpTreeNode[] }`) exported from `@/help`; `HELP_TREE: HelpTreeNode[]` exported from `@/help-content`; `flattenNodes(tree: HelpTreeNode[]): HelpTreeNode[]` and `ancestorIdsForTopic(tree: HelpTreeNode[], topicId: string): string[]` exported from `@/help`. Task 4's `mobile/app/(tabs)/help.tsx` imports all four of these directly.

- [ ] **Step 1: Write the failing tree-integrity test**

Create `mobile/__tests__/help/tree.test.ts`:

```ts
import { HELP_TOPICS, HELP_TREE } from "@/help-content";
import { ancestorIdsForTopic, flattenNodes, type HelpTreeNode } from "@/help";

// Topics that intentionally have no tree leaf (search-only). Empty today —
// every real topic must be reachable by navigating the tree.
const SEARCH_ONLY_ALLOWLIST: string[] = [];

// HelpButton `topic="<id>"` literals found across the app (grep for
// `topic="` under mobile/app and mobile/src, excluding tests) — every one
// must resolve to a reachable tree leaf so contextual "?" buttons keep
// working. See mobile/app/sign-in.tsx, paywall.tsx, (tabs)/settings.tsx,
// (tabs)/books.tsx, book/generate/[id].tsx, book/read/[id].tsx,
// book/saved/[id].tsx.
const KNOWN_HELP_BUTTON_TOPICS = [
  "getting-started-account",
  "plans",
  "provider-keys",
  "formats",
  "scoped-generation",
  "reading-a-book",
  "share-a-draft",
];

describe("HELP_TREE integrity", () => {
  const nodes = flattenNodes(HELP_TREE);
  const topicIds = new Set(HELP_TOPICS.map((t) => t.id));
  const treeTopicIds = new Set(
    nodes.map((n) => n.topicId).filter((id): id is string => Boolean(id)),
  );

  it("every node id is unique", () => {
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every node.topicId resolves to a real HELP_TOPICS id", () => {
    for (const n of nodes) {
      if (n.topicId) expect(topicIds.has(n.topicId)).toBe(true);
    }
  });

  it("every HELP_TOPICS id is reachable as some node's topicId (or is explicitly allow-listed)", () => {
    const unreachable = HELP_TOPICS.map((t) => t.id).filter(
      (id) => !treeTopicIds.has(id) && !SEARCH_ONLY_ALLOWLIST.includes(id),
    );
    expect(unreachable).toEqual([]);
  });

  it("every known HelpButton topic literal is a reachable tree leaf", () => {
    const missing = KNOWN_HELP_BUTTON_TOPICS.filter((id) => !treeTopicIds.has(id));
    expect(missing).toEqual([]);
  });
});

describe("ancestorIdsForTopic", () => {
  it("returns the root-to-parent chain of branch ids for a nested leaf", () => {
    const tree: HelpTreeNode[] = [
      {
        id: "a",
        title: "A",
        children: [
          {
            id: "b",
            title: "B",
            children: [{ id: "c", title: "C", topicId: "leaf-topic" }],
          },
        ],
      },
    ];
    expect(ancestorIdsForTopic(tree, "leaf-topic")).toEqual(["a", "b"]);
  });

  it("returns an empty array when the topicId isn't in the tree", () => {
    const tree: HelpTreeNode[] = [{ id: "a", title: "A", topicId: "x" }];
    expect(ancestorIdsForTopic(tree, "missing")).toEqual([]);
  });
});

describe("flattenNodes", () => {
  it("visits every node depth-first, branches before their children", () => {
    const tree: HelpTreeNode[] = [
      { id: "a", title: "A", children: [{ id: "b", title: "B", topicId: "x" }] },
      { id: "c", title: "C", topicId: "y" },
    ];
    expect(flattenNodes(tree).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd mobile && npx jest __tests__/help/tree.test.ts`
Expected: FAIL — `Cannot find module '@/help-content'` doesn't apply (module exists), but `HELP_TREE` is `undefined` (no export yet) and `ancestorIdsForTopic`/`flattenNodes` are `undefined` (not exported from `@/help` yet), so every test throws a `TypeError`.

- [ ] **Step 3: Add `HelpTreeNode` to the schema**

In `mobile/src/help/schema.ts`, append after the `HelpTopic` interface:

```ts
// A node in the Help navigation tree (Help Tree Restructure, 2026-08-18).
// Decoupled from HelpTopic on purpose: structure (this) and content
// (HelpTopic) evolve independently. A node is a LEAF when `topicId` is set
// and `children` is not — it renders the referenced HelpTopic's blocks. A
// node is a BRANCH when `children` is set — it renders as a collapsible
// section, and MAY also carry its own `topicId` for branch-level intro
// content. Depth is arbitrary (a tab with several sub-options is 3 levels).
export interface HelpTreeNode {
  id: string;
  title: string;
  blurb?: string;
  topicId?: string;
  children?: HelpTreeNode[];
}
```

- [ ] **Step 4: Add the engine-side traversal helpers**

Create `mobile/src/help/tree.ts`:

```ts
import type { HelpTreeNode } from "./schema";

// Every node in the tree, depth-first — a branch is visited before its own
// children.
export function flattenNodes(tree: HelpTreeNode[]): HelpTreeNode[] {
  const out: HelpTreeNode[] = [];
  const walk = (nodes: HelpTreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

// The ids of every ANCESTOR branch of the node whose `topicId` matches
// `topicId`, in root-to-parent order (the matching node itself is excluded).
// Returns [] if no node in the tree carries that topicId.
export function ancestorIdsForTopic(tree: HelpTreeNode[], topicId: string): string[] {
  const path: string[] = [];
  const search = (nodes: HelpTreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.topicId === topicId) return true;
      if (n.children && search(n.children)) {
        path.unshift(n.id);
        return true;
      }
    }
    return false;
  };
  return search(tree) ? path : [];
}
```

- [ ] **Step 5: Export the new schema type and helpers from the engine barrel**

In `mobile/src/help/index.ts`, replace:

```ts
export type { HelpBlock, HelpTopic } from "./schema";
export { blockText, searchHelpTopics } from "./search";
export { uncoveredFeatures } from "./coverage";
export { HelpButton } from "./components/HelpButton";
export { HelpHint } from "./components/HelpHint";
export { HelpTopicView } from "./components/HelpTopicView";
```

with:

```ts
export type { HelpBlock, HelpTopic, HelpTreeNode } from "./schema";
export { blockText, searchHelpTopics } from "./search";
export { uncoveredFeatures } from "./coverage";
export { ancestorIdsForTopic, flattenNodes } from "./tree";
export { HelpButton } from "./components/HelpButton";
export { HelpHint } from "./components/HelpHint";
export { HelpTopicView } from "./components/HelpTopicView";
```

- [ ] **Step 6: Author the tree data**

Create `mobile/src/help-content/tree.ts`:

```ts
import type { HelpTreeNode } from "@/help";

// The Help navigation tree (Help Tree Restructure, 2026-08-18). References
// HELP_TOPICS by id — content lives in topics.ts, this file is structure
// only.
//
// "How generation works" holds scoped-generation/diagram-types/formats, which
// the design spec's D3 tree layout listed as topics to KEEP but didn't place
// anywhere (they're not in the DROPPED list, so the coverage-preservation
// rule requires they stay reachable). They are cross-cutting CONCEPTS (how
// scoping shapes a draft, which diagrams the AI produces, output formats) that
// apply wherever content is generated — including Projects › Drafts — so they
// live in a neutral concepts branch rather than naming the nav-hidden Studio tab.
export const HELP_TREE: HelpTreeNode[] = [
  {
    id: "getting-started",
    title: "Getting started",
    children: [
      { id: "leaf-welcome", title: "Welcome & setup steps", topicId: "getting-started" },
      { id: "leaf-account", title: "Create your account & sign in", topicId: "getting-started-account" },
      { id: "leaf-provider-keys", title: "Choose a provider & get an API key", topicId: "provider-keys" },
      { id: "leaf-plans", title: "Plans & billing", topicId: "plans" },
      { id: "leaf-appearance", title: "Appearance & themes", topicId: "appearance" },
    ],
  },
  {
    id: "projects",
    title: "Projects — your studio",
    blurb: "The expert-validation loop: capture, draft, validate, share.",
    children: [
      {
        id: "projects-overview",
        title: "Overview",
        children: [
          { id: "leaf-what-is-a-project", title: "What is a project?", topicId: "projects" },
          { id: "leaf-project-fields", title: "New project fields", topicId: "project-fields" },
        ],
      },
      { id: "leaf-input", title: "Input", topicId: "sources" },
      { id: "leaf-structure", title: "Structure", topicId: "project-structure" },
      {
        id: "projects-drafts",
        title: "Drafts",
        children: [
          { id: "leaf-drafts", title: "Generating drafts", topicId: "project-drafts" },
          { id: "leaf-generate-full-book", title: "Generate the whole book at once", topicId: "generate-full-book" },
        ],
      },
      {
        id: "projects-feedback",
        title: "Feedback",
        children: [
          { id: "leaf-reviews-tab", title: "The Reviews tab", topicId: "reviews" },
          { id: "leaf-draft-viewer", title: "Read, approve & revise a draft", topicId: "draft-viewer" },
          { id: "leaf-grounding-report", title: "Quality report", topicId: "grounding-report" },
        ],
      },
      {
        id: "projects-publish",
        title: "Publish",
        children: [
          { id: "leaf-project-publish", title: "Exporting & sharing validated work", topicId: "project-publish" },
          { id: "leaf-word-export", title: "Word (.docx) export", topicId: "word-export" },
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
        ],
      },
    ],
  },
  {
    id: "how-generation-works",
    title: "How generation works",
    blurb: "The concepts behind drafting — scoping, diagram types, and output formats.",
    children: [
      { id: "leaf-scoped-generation", title: "How scoping works", topicId: "scoped-generation" },
      { id: "leaf-diagram-types", title: "Diagram types", topicId: "diagram-types" },
      { id: "leaf-formats", title: "Formats & books", topicId: "formats" },
    ],
  },
  {
    id: "share-shortform",
    title: "Share & short-form",
    blurb: "The Publish nav tab — posts, image cards, carousels, animated cards.",
    children: [
      { id: "leaf-make-a-post", title: "Make a post from your writing", topicId: "make-a-post" },
      { id: "leaf-publish-card", title: "Publish an image card", topicId: "publish-card" },
      { id: "leaf-publish-carousel", title: "Publish a carousel", topicId: "publish-carousel" },
      { id: "leaf-publish-animated", title: "Publish an animated card", topicId: "publish-animated" },
    ],
  },
  {
    id: "reading-library",
    title: "Reading & Library",
    children: [
      { id: "leaf-reading-a-book", title: "Open a book & get around", topicId: "reading-a-book" },
      { id: "leaf-share-a-draft", title: "Share a draft for feedback", topicId: "share-a-draft" },
      { id: "leaf-attach-figures", title: "Add figures to a topic", topicId: "attach-figures" },
    ],
  },
  {
    id: "reference",
    title: "Reference",
    children: [
      { id: "leaf-glossary", title: "Glossary", topicId: "glossary" },
      { id: "leaf-troubleshooting", title: "Troubleshooting", topicId: "troubleshooting" },
    ],
  },
];
```

Note: `leaf-welcome`'s title is deliberately "Welcome & setup steps", not "Getting started" — its parent branch is already titled "Getting started"; giving the leaf the identical title would render two identical-text rows simultaneously once the branch is expanded (both an accordion UX problem and an RNTL `getByText` ambiguity — see Task 4).

- [ ] **Step 7: Export `HELP_TREE` from the content barrel**

In `mobile/src/help-content/index.ts`, replace:

```ts
export { FEATURES, type FeatureKey } from "./features";
export { HELP_TOPICS } from "./topics";
```

with:

```ts
export { FEATURES, type FeatureKey } from "./features";
export { HELP_TOPICS } from "./topics";
export { HELP_TREE } from "./tree";
```

- [ ] **Step 8: Run the tree test and confirm it passes**

Run: `cd mobile && npx jest __tests__/help/tree.test.ts`
Expected: PASS — all 6 assertions green. (If "every HELP_TOPICS id is reachable" fails, cross-check the failing id against the topic → tree-leaf mapping table in the spec and Task 2's new topics — every one of the 29 topic ids must appear as some node's `topicId` in `HELP_TREE`.)

- [ ] **Step 9: Run the full Help suite and typecheck**

Run: `cd mobile && npx jest help && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 10: Commit**

```bash
cd mobile
git add src/help/schema.ts src/help/tree.ts src/help/index.ts src/help-content/tree.ts src/help-content/index.ts __tests__/help/tree.test.ts
git commit -m "$(cat <<'EOF'
feat(help): add HelpTreeNode schema, HELP_TREE data, and tree traversal helpers

HelpTopic is untouched — HelpTreeNode is a separate structure type that
references topics by id, so content and navigation evolve independently.
flattenNodes/ancestorIdsForTopic (mobile/src/help/tree.ts) let the Help
screen resolve a ?topic=<id> deep link to its ancestor branches. tree.test.ts
asserts every topic is reachable, every topicId resolves, node ids are
unique, and every known HelpButton topic= literal is a reachable leaf.
EOF
)"
```

---

### Task 4: Render the accordion (`mobile/app/(tabs)/help.tsx`)

**Files:**
- Modify: `mobile/app/(tabs)/help.tsx` (full rewrite: flat render → recursive accordion)
- Modify: `mobile/__tests__/screens/Help.test.tsx` (adapt existing tests to the accordion + add interaction tests)

**Interfaces:**
- Consumes: `HELP_TOPICS`, `HELP_TREE` (`mobile/src/help-content`); `searchHelpTopics`, `HelpTopicView`, `ancestorIdsForTopic`, `HelpTreeNode` (`mobile/src/help`); `relaunchStep`, `StepId` (`mobile/src/onboarding/firstRunState`); `Card`, `Label` (`mobile/src/components/ui`); `PageContainer` (`mobile/src/components/PageContainer`).
- Produces: the `HelpScreen` default export (unchanged signature — an Expo Router screen component with no props), now rendering `HELP_TREE` as a collapsible accordion instead of a flat topic list. Nothing outside this file imports from it.

- [ ] **Step 1: Read the current screen test to know what must keep passing**

`mobile/__tests__/screens/Help.test.tsx` currently has 3 tests: (1) the "Help" title renders in Fraunces semibold, non-bold; (2) `screen.getByText("Getting started")` (today the first topic's title, rendered flat and expanded) has uppercase `Label` styling; (3) the search box exists and `screen.getByText(/Mentible turns what you want to learn/)` — the `getting-started` topic's opening sentence — renders immediately. Tests (2) and (3) assume every topic renders fully expanded with no interaction, which the accordion (collapsed by default) breaks by design — they must be rewritten, not just left alone.

- [ ] **Step 2: Write the failing accordion interaction tests**

Replace the full contents of `mobile/__tests__/screens/Help.test.tsx` with:

```tsx
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FRAUNCES } from "@/constants/fonts";

const mockUseLocalSearchParams = jest.fn(() => ({} as { topic?: string }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

import HelpScreen from "../../app/(tabs)/help";

// Flattens an RN style (object | array | nested array) into a single object so
// tests can inspect the resolved fontFamily/fontWeight without caring how many
// style arrays a primitive wraps things in.
function flattenStyle(style: unknown): Record<string, unknown> {
  const arr = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe("HelpScreen", () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it("renders the Help title in Fraunces with no bold (700/600) weight — Studio re-skin", () => {
    render(<HelpScreen />);
    const style = flattenStyle(screen.getByText("Help").props.style);
    expect(style["fontFamily"]).toBe(FRAUNCES.semibold);
    expect(style["fontWeight"]).not.toBe("700");
    expect(style["fontWeight"]).not.toBe("600");
  });

  it("renders search-result topic titles via the Label primitive (uppercase, never bold)", () => {
    render(<HelpScreen />);
    fireEvent.changeText(screen.getByLabelText("Search help"), "billing");
    const style = flattenStyle(screen.getByText("Plans & billing").props.style);
    expect(style["textTransform"]).toBe("uppercase");
    expect(style["fontWeight"]).not.toBe("700");
    expect(style["fontWeight"]).not.toBe("600");
  });

  it("renders the tree collapsed by default — no topic body visible until expanded", () => {
    render(<HelpScreen />);
    expect(screen.getByText("Getting started")).toBeTruthy(); // top-level branch row
    expect(screen.queryByText(/Mentible turns what you want to learn/)).toBeNull();
  });

  it("expands a branch on tap to reveal its leaves, and collapses again on a second tap", () => {
    render(<HelpScreen />);
    const branch = screen.getByTestId("help-branch-getting-started");
    fireEvent.press(branch);
    expect(screen.getByText("Welcome & setup steps")).toBeTruthy();
    fireEvent.press(branch);
    expect(screen.queryByText("Welcome & setup steps")).toBeNull();
  });

  it("expands a leaf on tap to reveal its topic content", () => {
    render(<HelpScreen />);
    fireEvent.press(screen.getByTestId("help-branch-getting-started"));
    fireEvent.press(screen.getByTestId("help-leaf-leaf-welcome"));
    expect(screen.getByText(/Mentible turns what you want to learn/)).toBeTruthy();
  });

  it("search filters to matching topics without needing the tree expanded", () => {
    render(<HelpScreen />);
    fireEvent.changeText(screen.getByLabelText("Search help"), "byok");
    expect(screen.getByText(/Bring Your Own Key/)).toBeTruthy();
  });

  it("a ?topic=<id> deep link expands every ancestor branch and surfaces the leaf", async () => {
    mockUseLocalSearchParams.mockReturnValue({ topic: "plans" });
    render(<HelpScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Paid plans aren't available yet/)).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `cd mobile && npx jest __tests__/screens/Help.test.tsx`
Expected: FAIL — `screen.getByTestId("help-branch-getting-started")` and the accordion-specific assertions don't exist yet; the current flat renderer shows every topic body immediately (so "collapsed by default" also fails).

- [ ] **Step 4: Rewrite the Help screen**

Replace the full contents of `mobile/app/(tabs)/help.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { searchHelpTopics, HelpTopicView, ancestorIdsForTopic, type HelpTreeNode } from "@/help";
import { HELP_TOPICS, HELP_TREE } from "@/help-content";
import { relaunchStep, type StepId } from "@/onboarding/firstRunState";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Card, Label } from "@/components/ui";

const TOPICS_BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]));

// Help screen — renders HELP_TREE as a recursive, collapsible accordion
// (Help Tree Restructure, 2026-08-18; was a flat topic list, issue #60).
// Content lives in help-content/ (topics.ts + tree.ts); search + rendering
// logic lives in the help engine (@/help). Search flattens to matching
// topics regardless of tree state. A `?topic=<id>` deep link (from
// contextual HelpButtons) expands every ancestor branch of that topic's
// leaf, then scrolls to + briefly highlights it.
export default function HelpScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const searchResults = useMemo(
    () => (searching ? searchHelpTopics(query, HELP_TOPICS) : []),
    [query, searching],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const [highlight, setHighlight] = useState<string | undefined>(undefined);

  const scrollToNode = useCallback((id: string) => {
    const y = offsets.current[id];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
      setHighlight(id);
    }
  }, []);

  // Deep link: expand every ancestor branch of the leaf whose topicId
  // matches `?topic=<id>`, then scroll to + highlight it once layout settles.
  useEffect(() => {
    if (!topic) return;
    const ancestors = ancestorIdsForTopic(HELP_TREE, String(topic));
    if (ancestors.length === 0) return;
    setExpanded((prev) => new Set([...prev, ...ancestors]));
    const h = setTimeout(() => scrollToNode(String(topic)), 250);
    return () => clearTimeout(h);
  }, [topic, scrollToNode]);

  const onLink = useCallback((href: string) => router.push(href as Href), [router]);
  const onAction = useCallback((step: string) => void relaunchStep(step as StepId), []);

  const renderNode = (node: HelpTreeNode, depth: number): React.ReactNode => {
    const isBranch = Boolean(node.children && node.children.length > 0);
    const isOpen = expanded.has(node.id);
    const topicObj = node.topicId ? TOPICS_BY_ID.get(node.topicId) : undefined;

    return (
      <View
        key={node.id}
        style={[styles.node, { paddingLeft: depth * spacing.md }]}
        onLayout={(e: LayoutChangeEvent) => {
          offsets.current[node.id] = e.nativeEvent.layout.y;
          if (topic && node.topicId === String(topic)) scrollToNode(node.id);
        }}
      >
        <Pressable
          onPress={() => toggle(node.id)}
          accessibilityRole="button"
          accessibilityLabel={node.title}
          accessibilityState={{ expanded: isOpen }}
          testID={isBranch ? `help-branch-${node.id}` : `help-leaf-${node.id}`}
          style={styles.row}
        >
          <Text style={styles.chevron}>{isOpen ? "▾" : "▸"}</Text>
          <Text style={styles.rowTitle}>{node.title}</Text>
        </Pressable>
        {node.blurb ? <Text style={styles.blurb}>{node.blurb}</Text> : null}

        {isOpen && topicObj ? (
          <Card style={[styles.cardInner, highlight === node.id && styles.cardHighlight]}>
            <HelpTopicView topic={topicObj} onLink={onLink} onAction={onAction} />
          </Card>
        ) : null}
        {isOpen && isBranch
          ? node.children!.map((child) => renderNode(child, depth + 1))
          : null}
      </View>
    );
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer>
        <Text style={styles.title}>Help</Text>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (highlight) setHighlight(undefined);
          }}
          placeholder="Search help…"
          placeholderTextColor={theme.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search help"
        />

        {searching ? (
          searchResults.length === 0 ? (
            <Text style={styles.empty}>No help topics match “{query.trim()}”.</Text>
          ) : (
            searchResults.map((t) => (
              <View key={t.id} style={styles.section}>
                <Label tone="secondary">{t.title}</Label>
                <Card style={styles.cardInner}>
                  <HelpTopicView topic={t} onLink={onLink} onAction={onAction} />
                </Card>
              </View>
            ))
          )
        ) : (
          HELP_TREE.map((node) => renderNode(node, 0))
        )}
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" },
  scrollContent: { flexGrow: 1 },
  title: {
    color: c.text,
    fontSize: typography.sizeXl,
    fontFamily: FRAUNCES.semibold,
    letterSpacing: -0.36,
    marginBottom: spacing.xs,
  },
  search: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: c.text,
    fontSize: typography.sizeMd,
    marginBottom: spacing.sm,
  },
  empty: { color: c.textMuted, fontSize: typography.sizeSm, paddingVertical: spacing.md },
  section: { gap: spacing.xs, marginBottom: spacing.md },
  // Layout only — the surface, border, and padding come from <Card>.
  cardInner: { gap: spacing.sm },
  cardHighlight: { borderColor: c.primary },
  node: { marginBottom: spacing.xs },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chevron: { width: 16 as const, color: c.textSecondary, fontSize: typography.sizeSm },
  rowTitle: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const, flexShrink: 1 as const },
  blurb: { color: c.textMuted, fontSize: typography.sizeXs, marginLeft: 24 as const, marginBottom: spacing.xs },
});
```

- [ ] **Step 5: Run the screen test and confirm it passes**

Run: `cd mobile && npx jest __tests__/screens/Help.test.tsx`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Run the full Help suite**

Run: `cd mobile && npx jest help`
Expected: PASS — all files, including `content.test.ts` and `tree.test.ts` from Tasks 1–3, still green (nothing in this task touches `HELP_TOPICS`, `FEATURES`, or `HELP_TREE`).

- [ ] **Step 7: Typecheck and lint**

Run: `cd mobile && npx tsc --noEmit && npx eslint "app/(tabs)/help.tsx" "__tests__/screens/Help.test.tsx"`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd mobile
git add "app/(tabs)/help.tsx" __tests__/screens/Help.test.tsx
git commit -m "$(cat <<'EOF'
feat(help): render HELP_TREE as a recursive collapsible accordion

Replaces the flat "expand every topic" render with a recursive accordion
over HELP_TREE — branch rows toggle expand/collapse (▸/▾), leaf rows render
HelpTopicView when open. Collapsed by default. Search still flattens to
matching HELP_TOPICS regardless of tree state. ?topic=<id> deep links now
expand every ancestor branch (ancestorIdsForTopic) before scrolling to +
highlighting the leaf.
EOF
)"
```

---

## Self-Review

**Spec coverage.**
- D1 (accordion tree, one component, search + deep-link preserved, no `.web` variant/drill-down routing) → Task 4.
- D2 (drop Shelves cluster + its keys) → Task 1, Steps 6–8, plus the starter-claim.test.ts fix (Step 9) the spec itself doesn't mention but is required to keep the suite green.
- D3 (restructure + fix stale `reading-a-book`/`share-a-draft` + full Project detail) → Task 1 Steps 4–5 (stale fixes), Task 2 (full Project detail).
- Coverage-preservation rule (never delete a non-dropped topic, new keys ship with their topic in the same task) → enforced by construction in every task's red/green cycle (Tasks 1, 2).
- Topic → tree-leaf mapping table → every row is present in `HELP_TREE` (Task 3, Step 6); `tree.test.ts` mechanically checks full reachability rather than trusting the mapping by inspection.
- `chapter-quiz` nudge dead-link risk (spec's Non-goals section) → verified NOT a dead link (Task 1, Step 1) — the nudge is a dismissible in-page banner (`testID="nudge-chapter-quiz"`), never a `router.push({ pathname: "/help", params: { topic: "chapter-quiz" } })` call.
- "Exact on-screen labels" constraint → Project tab labels (Input/Structure/Drafts/Feedback/Publish) used verbatim as tree node titles in Task 3; nav labels (Library/Projects/Reviews/Publish/Settings/Help/About) used verbatim in the Task 1 `reading-a-book` fix.
- Testing section (coverage gate green, new `tree.test.ts`, `help.tsx` RNTL tests, manual verify) → Tasks 1–4's Step sequences cover all of these except the manual web/APK check, which is out of scope for a plan that produces no deploy — noted below as the one item with no task.

**Gap not mapped to a task:** the spec's Testing section item "Manual: web `/help` renders the tree; APK Help tab navigates it" has no corresponding task step — it's a manual device/browser verification step, not something expressible as a TDD task in this plan. Recommend running it once after Task 4 lands, via the `mobile:verify` skill, before considering the branch done.

**Placeholder scan.** No TBD/TODO/"add appropriate", no "similar to Task N" cross-references — every task repeats the full real code it touches (including the exact old_string being replaced) so it can be read out of order.

**Type-name consistency.** `HelpTreeNode` (schema.ts, Task 3) is the same name used in `tree.ts` (both files), `mobile/src/help-content/tree.ts`'s `HELP_TREE: HelpTreeNode[]`, and Task 4's `renderNode(node: HelpTreeNode, depth: number)` — checked consistent throughout. `flattenNodes`/`ancestorIdsForTopic` names match between their Task 3 definition, `tree.test.ts`'s imports, and Task 4's `help.tsx` usage (`ancestorIdsForTopic` only; `flattenNodes` is exported but not consumed by `help.tsx` — it's used by `tree.test.ts` only, which is intentional since the screen doesn't need a flat list, only the ancestor-chain lookup).
