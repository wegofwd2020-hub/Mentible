# Slice D — Publish assembly (validated topics → a book) — Design

**Status:** Approved (brainstorming, 2026-08-09). Final slice of the Projects TOC-structure arc
(`docs/superpowers/specs/2026-08-07-projects-toc-structure-arc-design.md`). Follows Slice C2 (per-topic
generate + validate, all live). Closes the loop: Capture → Structure → Create → Validate → **Publish**.

## Problem

Per-topic authoring produces a set of validated `topic_version` drafts, but there's no way to turn
them into a single deliverable. Today's Publish handles only the whole-book path (one artifact →
`artifactToBook` → Library/EPUB/PDF). Slice D assembles the validated per-topic drafts into one
**multi-topic book** and hands it to the existing export machinery.

## Goal

From the Publish phase (per-topic mode), when the book is fully validated, **Publish book**: fetch each
TOC topic's validated draft, assemble an ordered multi-topic `Book` (matching the TOC), and Add it to
the Library / export EPUB·PDF via the existing pipeline.

## Locked decisions (brainstorming 2026-08-09)

1. **Gate on `book_validated`.** Publish book is enabled only when every current TOC topic is validated
   (`project.book_validated`). A partially-validated book can't be published (trust is the product).
2. **Client-side assembly, mobile-only.** For each TOC topic, fetch its validated draft
   (`getTopicVersion(latest_version_id)`, already live) and assemble the `Book` locally. No backend,
   no migration → **web redeploy only**. (Since we gate on `book_validated`, each topic's
   `latest_version_id` from `topic_status` IS its validated version — no ambiguity.)
3. **Multi-topic Book** (not one blob): each TOC topic → a Book unit (`id` = the TOC topic id, its
   title, subtopics, prerequisites) with `content[topicId].lesson.sections` from that topic's draft,
   ordered by the TOC (subjects → units). One **aggregated Sources unit** appended at the end.
4. **Reuse the export pipeline verbatim** — feed the assembled `Book` into `saveBook` (Add-to-Library)
   and `trackedExport` → `downloadArtifact` (EPUB/PDF), exactly as the whole-book path does.
5. Book **title = the project title**.

## Architecture

### Converter (`mobile/src/lib/topicsToBook.ts`, new — parallels `artifactToBook`)

```ts
topicsToBook(
  projectTitle: string,
  toc: StructuredTocView,                 // project.toc (subjects → units)
  topicSections: Map<string, DraftSection[]>,  // topicId → that topic's validated sections
  inputs: ProjectInputView[],
): Book
```
- For each `subject` in `toc.subjects`, for each `unit`: a `TopicNode { id: unit.id, title: unit.title,
  subtopics: [], prerequisites: [] }` in the book's `toc`; and `content[unit.id] = { topicId: unit.id,
  title: unit.title, lesson: { topic: unit.title, ...emptyLessonFields, sections: (topicSections.get(
  unit.id) ?? []).map(s => ({ heading: s.heading, body_markdown: s.body })) }, generatedAt: now }`.
- **Aggregated Sources:** collect `cited = unique(source_ids across all topics' sections)`; if any,
  append a final synthetic unit (`id: randomUUID(), title: "Sources"`) as its own subject
  (`subject_label: "Sources"`) with a lesson whose single section is the `[S1] name` list (reuse
  `artifactToBook`'s `labelFor`/`byId` logic). Skip when nothing is cited.
- `Book` shape matches `artifactToBook`'s output (id/title/toc/content/createdAt/updatedAt) — so the
  export pipeline consumes it unchanged.

### Orchestration (`mobile/app/trust/[projectId].tsx`, `PublishPanel`)

- Add the `Whole book | Per topic` toggle to `PublishPanel` (TOC-gated, default whole-book — mirrors
  Drafts/Validate; the existing whole-book Publish content is unchanged under `mode==="whole"`).
- Per-topic view: the **book rollup** ("N/M topics validated") + a **Publish book** section with
  **Add to Library** + **Download EPUB/PDF** actions, **disabled unless `book_validated`** (else a
  "Validate all topics first — N/M" hint).
- On a Publish action: gather each TOC topic's validated sections — for every `unit.id` with a
  `topic_status` entry carrying `latest_version_id`, `await getTopicVersion(latest_version_id, token)`
  → `content.sections`; build `Map<topicId, sections>`; `topicsToBook(project.title, toc, map, inputs)`;
  then `saveBook(book)` (Library) or `trackedExport(book, fmt)` → `downloadArtifact(...)` (EPUB/PDF) —
  the SAME calls the whole-book handlers use. A per-book busy state; errors via `Alert` +
  `ApiError.userMessage()`.
- Owner-only publish (mirror the existing Publish owner-gating). The fetch loop uses the hook's token.

## Reuse

- `saveBook` / `trackedExport` / `downloadArtifact` (the whole-book export path) — verbatim, fed the
  assembled multi-topic Book.
- `getTopicVersion` (C2a) for the per-topic content fetch; `project.topic_status`/`book_validated`
  (C1/C2b) for the gate + the topic list; `artifactToBook`'s Sources-list logic (copied into
  `topicsToBook`).
- The Publish per-topic toggle + rollup header reuse the Drafts/Validate pattern.

## Data flow

```
Publish › Per topic (book_validated=true) → [Add to Library] / [Download EPUB·PDF]
  → for each toc topic: getTopicVersion(latest_version_id) → sections
  → topicsToBook(projectTitle, toc, {topicId→sections}, inputs) → multi-topic Book
  → saveBook(book)  |  trackedExport(book, fmt) → downloadArtifact(...)
```

## Error handling

- Publish disabled unless `book_validated` (UI gate) — the assembly assumes all topics have a
  validated `latest_version_id`; a topic missing one (shouldn't happen when book_validated) is skipped
  with its unit omitted (defensive).
- A `getTopicVersion` failure mid-assembly → abort with an Alert (`userMessage()`), no partial export.
- Export failure (`trackedExport`/compiler) → Alert, same as the whole-book path.

## Testing

**Mobile (Jest + RNTL):**
- `topicsToBook`: given a 2-subject TOC + a `topicId→sections` map + inputs → a Book whose `toc.subjects`
  mirror the input order, each `content[topicId].lesson.sections` maps `{heading, body}`→
  `{heading, body_markdown}`, and a final "Sources" unit lists the cited `[S1]` sources (and is omitted
  when nothing cited). Pure-function test, no mocks.
- `PublishPanel` per-topic: the toggle appears only with a TOC; Publish actions are **disabled when
  `book_validated=false`** (+ hint) and **enabled when true**; pressing Add-to-Library (book_validated)
  calls `getTopicVersion` per topic then `saveBook` with an assembled multi-topic Book (assert
  `saveBook` receives a Book with the right unit count); the whole-book Publish path stays unchanged.

## Files

- `mobile/src/lib/topicsToBook.ts` (new); `mobile/app/trust/[projectId].tsx` (`PublishPanel` per-topic
  mode + assembly handlers). Tests: `mobile/__tests__/lib/topicsToBook.test.ts` (new);
  `mobile/__tests__/screens/TrustProjectDetail.publish-pertopic.test.tsx` (new).

## Decomposition (Slice D plan)

- **T1 — `topicsToBook` converter** (pure lib fn + tests).
- **T2 — Publish per-topic mode + assembly orchestration** (toggle + gated Add-to-Library/Download +
  per-topic fetch → assemble → export).

## Rollout

**Mobile-only → web redeploy** (no backend, no migration). Closes the arc. Remaining after this:
Studio **P2** (app chrome), P3/P4.

## Out of scope

- A backend assemble endpoint (client-side N-fetch chosen). Per-topic individual download (the unit is
  the whole book). Regenerating/validating from Publish (done in earlier phases). Whole-book↔per-topic
  merged books (author picks a mode).

## Global constraints

Owner-only publish (existing gating); gate on `book_validated`. ADR-001: no api key on the
publish/assembly path (`getTopicVersion`/`saveBook`/`trackedExport` carry none). Studio primitives;
`useThemedStyles`; no color-literal test asserts.
