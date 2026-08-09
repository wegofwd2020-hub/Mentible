# Slice D — Publish assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble validated per-topic drafts into one multi-topic book and publish it (Add-to-Library / EPUB·PDF), gated on `book_validated`. Closes the Projects arc.

**Architecture:** A pure `topicsToBook` converter (parallels `artifactToBook`) builds a multi-topic `Book` from the TOC + per-topic sections; the Publish phase gains a per-topic mode that fetches each topic's validated draft (`getTopicVersion`), assembles the Book, and feeds it to the existing export pipeline (`saveBook`/`trackedExport`/`downloadArtifact`). Mobile-only.

**Tech Stack:** React Native + Expo TS (Jest/RNTL); Studio primitives; the existing book/compiler export pipeline.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-09-slice-d-publish-assembly-design.md`.
- **Gate on `book_validated`** — Publish actions enabled only when `project.book_validated` is true; else disabled + an "N/M topics validated" hint. Owner-only publish (mirror existing Publish gating).
- **Reuse the export pipeline VERBATIM:** the assembled `Book` goes into `saveBook(book)` (Library) and `trackedExport(book, fmt)` → `downloadArtifact(...)` (EPUB/PDF) — the same calls the whole-book `onAddToLibrary`/`onDownloadAsset` handlers use (`[projectId].tsx` ~1173-1200).
- **`Book` shape must match `artifactToBook`'s output** so the pipeline consumes it unchanged: `{ id, title, toc:{subjects:[{subject_label, units:[{id,title,subtopics:[],prerequisites:[]}]}]}, content:{[topicId]:{topicId,title,lesson,generatedAt}}, createdAt, updatedAt }`; `lesson` mirrors `artifactToBook`'s lesson object (`{topic, level:"", language:"en", synopsis:"", learning_objectives:[], sections:LessonSection[], key_takeaways:[], further_reading:[]}`); `LessonSection = {heading, body_markdown}`.
- Since we gate on `book_validated`, each topic's `latest_version_id` (from `topic_status`) is its validated version — fetch that.
- ADR-001: no api key on this path. Studio primitives; `useThemedStyles`; no color-literal test assertions. `npx tsc --noEmit` clean + full `npx jest` green. Mobile-only (no backend, no migration).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/lib/topicsToBook.ts` (new) — the converter (T1)
- `mobile/app/trust/[projectId].tsx` — `PublishPanel` per-topic mode + assembly handlers (T2)
- Tests: `mobile/__tests__/lib/topicsToBook.test.ts` (new, T1); `mobile/__tests__/screens/TrustProjectDetail.publish-pertopic.test.tsx` (new, T2)

---

### Task 1: `topicsToBook` converter (pure)

**Files:**
- Create: `mobile/src/lib/topicsToBook.ts`
- Test: `mobile/__tests__/lib/topicsToBook.test.ts` (new)

**Interfaces:**
- Produces: `topicsToBook(projectTitle: string, toc: StructuredTocView, topicSections: Map<string, DraftSection[]>, inputs: ProjectInputView[]): Book`.

- [ ] **Step 1: Write the failing test** (`topicsToBook.test.ts`): build a `StructuredTocView` with 2 subjects (subjectA→unit `u1`, subjectB→unit `u2`), a `topicSections` Map (`u1`→`[{heading:"Staff",body:"5 lines",source_ids:["i1"]}]`, `u2`→`[{heading:"Rhythm",body:"beats",source_ids:[]}]`), and `inputs:[{id:"i1", title:"Interview", ...}]`. Assert:
  - the returned Book `title` === the project title; `toc.subjects` preserve order (A then B) with units `u1`,`u2`;
  - `content["u1"].lesson.sections` === `[{heading:"Staff", body_markdown:"5 lines"}]` (maps `body`→`body_markdown`); `content["u2"]` similarly;
  - a final **"Sources"** subject/unit exists (because `i1` was cited) whose lesson lists `[S1] Interview`;
  - a variant with NO cited source_ids → NO Sources unit.
Pure function — no mocks. Import `Book`/`LessonSection`/`StructuredTocView`/`DraftSection`/`ProjectInputView` from their real modules.

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/lib/topicsToBook.test.ts`.

- [ ] **Step 3: Implement `topicsToBook.ts`** (model on `mobile/src/lib/artifactToBook.ts` — READ it for the lesson object shape, the `labelFor`/`byId`/`cited` Sources logic, and `randomUUID`):
  - `const now = new Date().toISOString(); const safeTitle = projectTitle.trim() || "Untitled";`
  - Build `subjects` + `content`: for each `subject` in `toc.subjects`, for each `unit` in `subject.units`, push a `TopicNode {id: unit.id, title: unit.title, subtopics: [], prerequisites: []}` under that subject, and set `content[unit.id] = { topicId: unit.id, title: unit.title, lesson: makeLesson(unit.title, topicSections.get(unit.id) ?? []), generatedAt: now }` where `makeLesson(title, secs)` returns the `artifactToBook` lesson object with `sections: secs.map(s => ({heading: s.heading, body_markdown: s.body}))`.
  - Aggregated Sources: `cited = [...new Set(all topics' sections flatMap source_ids)]`; if `cited.length`, append a subject `{subject_label:"Sources", units:[{id: sourcesId, title:"Sources", subtopics:[], prerequisites:[]}]}` and `content[sourcesId] = { topicId: sourcesId, title:"Sources", lesson: makeLesson("Sources", [{heading:"Sources", body: <the "[S1] name" list, same formatting as artifactToBook>}]), generatedAt: now }`. (Reuse `labelFor`/`byId` from artifactToBook's logic.) Skip when `cited` is empty.
  - Return `{ id: randomUUID(), title: safeTitle, toc: { subjects }, content, createdAt: now, updatedAt: now }`.

- [ ] **Step 4: Run test + tsc** — `cd mobile && npx jest __tests__/lib/topicsToBook.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/lib/topicsToBook.ts mobile/__tests__/lib/topicsToBook.test.ts
git commit -m "feat(trust): topicsToBook — assemble validated topics into a multi-topic Book (Slice D)"
```

---

### Task 2: Publish per-topic mode + assembly orchestration

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (`PublishPanel` + handlers in `TrustProjectDetailInner`)
- Test: `mobile/__tests__/screens/TrustProjectDetail.publish-pertopic.test.tsx` (new)

**Interfaces:**
- Consumes: `topicsToBook` (T1), `getTopicVersion` (C2a client), `project.toc`/`topic_status`/`book_validated`, and the existing `saveBook`/`trackedExport`/`downloadArtifact` (already imported in the file).

- [ ] **Step 1: Write the failing test** (`TrustProjectDetail.publish-pertopic.test.tsx`, mirror the C2b/C2c pertopic tests): owner project with `toc` (topics `t1,t2`) + `topic_status` (both `validated`, `latest_version_id` `tv1`/`tv2`). Mock `getTopicVersion` to resolve each topic's sections; mock the export deps (`saveBook`, `trackedExport`, `downloadArtifact` — jest.mock the modules). Switch to the Publish phase, assert:
  - a "Per topic" toggle present (TOC exists);
  - per-topic view shows the rollup + a Publish/Add-to-Library control;
  - with `book_validated:true`: pressing **Add to Library** calls `getTopicVersion` for each topic then `saveBook` with a Book whose `toc` has 2 topic units (assert unit count / titles);
  - with `book_validated:false` (a second render): the Publish actions are **disabled** (+ a validate-first hint);
  - a project with NO toc shows no "Per topic" control; whole-book Publish path unchanged.
Colors from theme, no hex; assert by accessibilityLabel/text.

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail.publish-pertopic.test.tsx`.

- [ ] **Step 3: Implement** in `PublishPanel` (`[projectId].tsx`) + `TrustProjectDetailInner`:
  - Add the `mode` toggle `Whole book | Per topic` to `PublishPanel` (render only when `toc?.subjects?.length`; default `"whole"`; reuse the SAME toggle pattern as Drafts/Validate). `mode==="whole"` → the existing PublishPanel content, UNCHANGED.
  - `mode==="topic"` → the rollup header ("N/M topics validated", from `topicStatus`/`bookValidated`) + a **Publish book** block: **Add to Library** + **Download EPUB** + **Download PDF** Buttons, `disabled` unless `bookValidated` (else show "Validate all topics first — N/M"). Owner-only.
  - Handlers in `TrustProjectDetailInner` (thread `toc`, `topicStatus`, `bookValidated` + the handlers into PublishPanel):
    - `assembleBook()` (async): for each `unit.id` across `toc.subjects[].units[]` with a `topic_status` entry carrying `latest_version_id`, `await getTopicVersion(latest_version_id, accessToken)` → `content.sections`; build `Map<topicId, DraftSection[]>`; return `topicsToBook(project.title, toc, map, inputs)`.
    - `onPublishToLibrary()`: setBusy → `const book = await assembleBook(); await saveBook(book);` → success/failure Alert; clear busy.
    - `onPublishDownload(fmt)`: setBusy → `const book = await assembleBook(); const res = await trackedExport(book, fmt, {diagrams:true}); await downloadArtifact(res.artifact, slug(project.title)+"."+fmt, fmt==="epub"?"application/epub+zip":"application/pdf");` → Alerts; clear busy. (Mirror the whole-book `onDownloadAsset` exactly, swapping `artifactToBook`→the assembled Book.)
    - Errors via `Alert` (`@/lib/alert`) + `e instanceof ApiError ? e.userMessage() : "..."`. A per-action busy state.
  - `getTopicVersion` imported from `@/api/trustClient`; `accessToken` obtained the way the screen already does for hook calls.

- [ ] **Step 4: Run the publish-pertopic test + full TrustProjectDetail suite + full jest + tsc** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx jest && npx tsc --noEmit`. The whole-book Publish tests must stay green (unchanged under the default mode). Adjust an existing Publish test only if it asserted structure now under the whole-book branch (note in report; don't weaken).

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.publish-pertopic.test.tsx
git commit -m "feat(trust): Publish per-topic mode — assemble + publish a validated book (Slice D)"
```

---

## Final verification (after both tasks)

- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green + clean; lint clean.
- [ ] Manual (optional, local): a fully-validated per-topic project → Publish › Per topic → Add to Library produces a multi-topic book in the Library; Download EPUB/PDF exports it; a not-fully-validated project shows Publish disabled.
- [ ] PR body: **mobile-only → web redeploy** (no backend refresh, no migration). Closes the Projects TOC-structure arc (Capture → Structure → Create → Validate → Publish).

## Self-Review

- **Spec coverage:** multi-topic converter (T1) · Publish per-topic mode + gated assembly/export (T2). Backend assemble endpoint + per-topic download correctly excluded.
- **Type consistency:** `topicsToBook` (T1) returns the same `Book` shape `artifactToBook` does → consumed by `saveBook`/`trackedExport` (T2) unchanged; `getTopicVersion`→`content.sections` (DraftSection[]) feeds `topicSections` (T1's param); `topic_status.latest_version_id`/`book_validated` (C1/C2b) drive the gate + fetch.
- **Placeholders:** none — the converter logic + the handler bodies (mirroring the whole-book handlers) are concrete.
- **ADR-001:** no key on the publish path; owner-gated; gate on `book_validated`.
