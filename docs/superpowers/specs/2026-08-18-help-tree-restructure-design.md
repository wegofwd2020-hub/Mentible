# Help Tree Restructure — Design Spec

**Status:** Proposed · **Date:** 2026-08-18 · **Area:** `mobile/src/help*`, `mobile/app/(tabs)/help.tsx`

## Why

The in-app Help (`/help` tab, also live at `mambakkam.net/app/mentible/help`) is a **flat list of ~28 topics** rendered as one long expanded scroll. Three problems:

1. **No structure.** As the app grew (Projects/trust studio, derivatives, exports) the flat list became hard to navigate. The user wants a **navigable tree**.
2. **Projects is now the core flow** but is under-documented — it's one topic-ish today, yet the real UI is a 5-tab studio (Input · Structure · Drafts · Feedback · Publish) with owner/reviewer-gated sub-options and a draft-viewer subscreen. It needs a detailed subtree.
3. **Stale copy from hidden nav.** `d3f8495` hid **Shelves (Open Shelves)** and **books ("Studio")** from the nav (routes kept). Help still names "Studio" and documents the Shelves cluster as if reachable.

## Decisions (locked with the user)

- **D1 — Accordion tree.** One page; collapsible sections; leaf topics expand inline. Keep the search box and the `?topic=<id>` deep-link (auto-expand ancestors + scroll-to). One component drives web + native (no drill-down routing, no `.web` variant).
- **D2 — Drop the Shelves cluster.** Remove `open-shelves`, `imported-books`, `chapter-quiz` topics **and** their `FEATURES` keys (`open-shelves`, `imported-books`, `chapter-quiz`) — don't document a nav-hidden feature. Routes stay deep-linkable, just undocumented.
- **D3 — Restructure + fix stale + full Project detail.** Build the tree, author the **entire Projects subtree** in detail, **fix** `reading-a-book` + `share-a-draft` stale copy, and **keep** the rest (getting-started, account, provider-keys, plans, appearance, glossary, troubleshooting, make-a-post/card/carousel/animated, formats, figures, word-export, kdp-export, projects/project-fields/reviews/sources/draft-viewer/grounding-report/generate-full-book) — re-homed into the tree, copy touched only where it references hidden nav.

## Architecture

### Data model — decouple *structure* from *content*

`HelpTopic` (`mobile/src/help/schema.ts`) stays **unchanged** (`id, title, keywords[], blocks[], featureKey?`), so the block-authoring format and the coverage gate are untouched. Add a **separate tree** that references topics by id:

```ts
// mobile/src/help/schema.ts (new)
export interface HelpTreeNode {
  id: string;               // stable node id (expand-state + section deep-link)
  title: string;
  blurb?: string;           // optional one-line section intro (branch nodes)
  topicId?: string;         // leaf → renders HELP_TOPICS.find(id === topicId)
  children?: HelpTreeNode[];// branch → nested nodes
}
```

- A node is a **leaf** (`topicId` set, no `children`) or a **branch** (`children` set, optional `topicId` for a branch that also has intro content). Arbitrary depth (Projects → tab → sub-option is 3 levels).
- `HELP_TREE: HelpTreeNode[]` lives in a new `mobile/src/help-content/tree.ts`. Content (topics) and structure (tree) evolve independently.

### Rendering — `mobile/app/(tabs)/help.tsx`

- Replace the flat "render every topic" loop with a recursive **accordion** over `HELP_TREE`: branch rows show a ▸/▾ affordance + `title` (+ `blurb`); tapping toggles expand. Leaf rows render the `title` + (when expanded) the existing `HelpTopicView` for the referenced topic. Default: top-level collapsed except "Getting started" (or all collapsed — implementer's call, keep it simple).
- **Search** (`searchHelpTopics`) still works: a non-empty query flattens to the matching topics (tree chrome hidden while searching, or matching branches force-expanded — either is fine; matching topics must be reachable).
- **`?topic=<id>` deep-link** must still work: on mount with a `topic` param, expand all ancestor branches of the leaf whose `topicId === param` and scroll-to/highlight it (today it scrolls by topic id). HelpButtons across the app pass `topic="<id>"` (e.g. `plans`, `provider-keys`, `getting-started-account`) — every such id MUST remain a reachable leaf in the tree (or at least a rendered topic), so those buttons keep working.

### Coverage gate & integrity

- The coverage gate (`mobile/__tests__/help/coverage.test.ts`) requires every `FEATURES` key on ≥1 topic + no orphan featureKeys. Dropping the 3 cluster topics **and** their 3 FEATURES keys together keeps it green.
- **New integrity test** (`mobile/__tests__/help/tree.test.ts`): (a) every `HelpTreeNode.topicId` resolves to a real `HELP_TOPICS` id; (b) no duplicate node `id`s; (c) every non-keyless… — actually: **every `HelpTopic` is reachable from the tree** OR explicitly allow-listed as "search-only" (prevents a topic silently disappearing from nav). Pick reachability: assert each `HELP_TOPICS[].id` appears as some node's `topicId`, except an allow-list constant for intentional search-only topics (empty at first). (c) every HelpButton `topic="…"` literal in the app resolves to a tree leaf — nice-to-have; at minimum keep the known ones (`plans`, `provider-keys`, `getting-started-account`, and any others found by grep) as leaves.

## Content — the tree

```
1. Getting started
   ├ getting-started          (keep)
   ├ getting-started-account  (keep)
   ├ provider-keys            (keep — BYOK)
   ├ plans                    (keep — plans & billing)
   └ appearance               (keep — themes)
2. Projects — your studio
   ├ Overview                 (NEW: create a project [Title/Topic/Audience/Goal] · the 5 tabs · next-step banner · roles owner/reviewer/editor)  — reuse/absorb `projects` + `project-fields`
   ├ Input                    (NEW/expand `sources`: Transcript/Note/Link · add/edit/delete · cited-source guard · reviewer read-only)
   ├ Structure                (NEW: outline · Suggest from sources · topic tree + citations · reviewer read-only)
   ├ Drafts                   (NEW: whole-book vs per-topic · 6 formats [LinkedIn/X/Reel/Podcast/Essay/Chapter outline] · Generate / Regenerate · Generate full book · versions · Compare/diff) — absorb `generate-full-book`
   ├ Feedback                 (NEW: review & approve · expert-validated vs operator-recorded · Invite Reviewer/Editor · Request a revision · comments · revision notes) — absorb `reviews`, `draft-viewer`, `grounding-report`
   └ Publish                  (NEW: validated exports Add to Library / EPUB / PDF / Word · Copy/Copy-as-Markdown · per-topic Publish book · Pro gating) — absorb `formats`, `word-export`, `kdp-export`
3. Share & short-form  (the separate Publish/Posts nav tab — NOT Project→Publish)
   ├ make-a-post              (keep)
   ├ publish-card             (keep)
   ├ publish-carousel         (keep)
   └ publish-animated         (keep)
4. Reading & Library
   ├ reading-a-book           (FIX: remove "Studio"/"five places" — nav is now Library · Projects · Reviews · Publish · Settings · Help · About)
   ├ share-a-draft            (FIX: remove the "Studio" badge instruction)
   └ attach-figures           (keep — device photo library, not app Library)
5. Reference
   ├ glossary                 (keep)
   └ troubleshooting          (keep — drop any Shelves mention)
DROPPED (topics + FEATURES keys): open-shelves, imported-books, chapter-quiz
```

### Coverage-preservation rule (critical)

Every currently-valid `FEATURES` key (all **except** the 3 dropped: `open-shelves`, `imported-books`, `chapter-quiz`) documents a feature that **still exists**, so its key must stay covered. Therefore:

- **Do NOT delete any non-dropped topic.** Rewrite/expand its copy and **re-home** it at a tree leaf — the topic object (and its `featureKey`) persists, so the gate stays green automatically.
- **Where a Project tab has no existing topic, add a NEW topic + a NEW `FEATURES` entry** (a new key needs its new covering topic — created in the same change).
- One tab = one branch; each tab's content is **one (or a few) leaf topics**; sub-options are **sections within** a topic (`text`/`steps`/`action` blocks), NOT a topic each. Don't explode every button into its own topic.

**Topic → tree-leaf mapping (existing keys preserved; NEW marked):**

| Tree location | Topic id(s) | FEATURES key | New? |
|---|---|---|---|
| Getting started | getting-started, getting-started-account, provider-keys, plans, appearance | (resp. keys) | keep |
| Projects › Overview | projects, project-fields | projects, project-fields | keep (rewrite) |
| Projects › Input | sources | sources | keep (expand) |
| Projects › Structure | **project-structure** | **project-structure** | **NEW** |
| Projects › Drafts | **project-drafts**, generate-full-book | **project-drafts**, generate-full-book | drafts leaf NEW; keep gen-full-book |
| Projects › Feedback | reviews, draft-viewer, grounding-report | reviews, draft-viewer, grounding-report | keep (rewrite) |
| Projects › Publish | **project-publish**, word-export, kdp-export | **project-publish**, word-export, kdp-export | publish-overview leaf NEW; keep word/kdp |
| Share & short-form | make-a-post, publish-card, publish-carousel, publish-animated | (resp.) | keep |
| Reading & Library | reading-a-book, share-a-draft, attach-figures | reading, sharing, figures | keep (fix stale) |
| Reference | glossary, troubleshooting | — | keep |
| — (DROPPED) | open-shelves, imported-books, chapter-quiz | open-shelves, imported-books, chapter-quiz | **remove topic + key** |

NEW FEATURES keys to add: `project-structure`, `project-drafts`, `project-publish` (each with its new topic). The exact final set of Project topics is the plan's to lock, but the rule stands: **no valid featureKey loses its topic.**
- Keep the **exact on-screen labels** from the UI map: Input (sources: Transcript/Note/Link), Structure (outline; "Suggest from sources"), Drafts (versions; "Generate full book"; Compare), Feedback (Approve/Unapprove/Request a revision/Invite an expert; "expert-validated" vs "operator-recorded"), Publish (Add to Library / Download EPUB/PDF/Word / Copy). Reviewer vs Owner vs Editor role notes on each.
- **Terminology honesty:** the tab is "Input" but controls say "source" — say both. Feedback ≠ the separate "Reviews" tab (that's the reviewer's inbox); cross-reference.

## Non-goals

- No change to the actual Project/trust UI — this is Help content + the Help screen only.
- No drill-down routing, no web-specific Help variant, no markdown block type (keep the existing typed blocks).
- Not documenting hidden features (Shelves/Studio) — dropped per D2.
- The `chapter-quiz` **discovery nudge** (`useNudge("chapter-quiz")` on the imported-book chapter reader) is a separate system keyed by a nudge-id, not the help topic; dropping the help topic is fine **unless** that nudge's tap target opens `?topic=chapter-quiz` — the plan must check and, if so, repoint or keep that one topic as a search-only keyless entry.

## Testing

- Coverage gate stays green (drop 3 topics + 3 FEATURES keys together).
- New `tree.test.ts`: topicId resolution, no dup node ids, topic reachability (allow-list for intentional search-only).
- `help.tsx` render/interaction tests: a branch expands/collapses; a leaf shows its topic; search filters; `?topic=<id>` expands ancestors + surfaces the topic. (RNTL; mock nav params.)
- Manual: web `/help` renders the tree; APK Help tab navigates it.

## Rollout

Content + screen change only → ships via `web-deploy.sh app` (web) and the next APK. No backend, no migration.
