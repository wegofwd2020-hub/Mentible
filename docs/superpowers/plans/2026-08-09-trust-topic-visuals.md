# Per-topic visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate grounded ```mermaid/```svg diagrams in per-topic drafts, render them in the in-app topic viewer, and (already) in the exported book — replacing the `[IMAGE:]` placeholders.

**Architecture:** Extend the topic prompt to author grounded diagrams (+ ban placeholders); render the topic viewer's section bodies through the reader's md→sanitize→enhance pipeline (`NativeTopicReader`) instead of plain `<Text>`; the compiler already renders diagrams for the exported book (verify). Reuse the Books/reader/compiler renderers — no new renderer.

**Tech Stack:** FastAPI + pydantic (pytest); React Native + Expo TS (Jest/RNTL); the reader (`@/reader/*`) + compiler (existing).

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-09-trust-topic-visuals-design.md`.
- **Diagram grounding = same bar as the prose** ("visualize what the sources establish; invent nothing; omit if unsupported"); the per-topic expert validation is the backstop. **Ban `[IMAGE: …]` / 📷 placeholders** — a real diagram or text only.
- **Reuse renderers — do NOT write a second markdown/diagram renderer** (`[[project_reader_one_renderer]]`). In-app: `@/reader/NativeTopicReader` (→ `topicHtml`/`renderContent`/`sanitize`/`enhance` + `reader/markdown.ts`). Export: the compiler's existing diagram rendering.
- **Model-authored SVG MUST pass the reader's sanitize boundary** (`sanitizeFragment` via `renderTopicToSafeHtml`) — never inject raw HTML. Same posture as Books.
- ADR-001: no api key on render/export. `useThemedStyles`; no color-literal test asserts. `npx tsc --noEmit` clean + full `npx jest` green; backend `ruff` clean.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `backend/src/trust/topic_prompt.py` — diagram guidance + placeholder ban (T1)
- `mobile/app/trust/topic-version/[id].tsx` — render body via `NativeTopicReader` (T2)
- `mobile/src/lib/topicVersionToTopic.ts` (new) OR extract from `topicsToBook.ts` — `topicVersion→GeneratedTopic` (T2)
- Tests: `backend/tests/test_trust_topic.py` (T1); `mobile/__tests__/screens/TopicVersionViewer.visuals.test.tsx` (T2); `mobile/__tests__/lib/topicsToBook.test.ts` (T3)

---

### Task 1: Topic prompt — grounded diagram guidance + ban placeholders

**Files:**
- Modify: `backend/src/trust/topic_prompt.py`
- Test: `backend/tests/test_trust_topic.py`

**Interfaces:**
- Produces: `build_topic_prompt(...)` includes diagram guidance (mermaid + svg), the grounding framing, and an explicit placeholder ban.

- [ ] **Step 1: Write the failing test** (`test_trust_topic.py`, extend `test_topic_prompt_*`):
```python
def test_topic_prompt_allows_grounded_diagrams_and_bans_placeholders():
    p = build_topic_prompt(_SOURCES, "Reading music", ["Staff & clef"], "beginners", "read music")
    low = p.lower()
    assert "mermaid" in low          # ```mermaid guidance
    assert "svg" in low              # ```svg guidance
    assert "invent nothing" in low   # grounding kept
    # placeholders explicitly banned
    assert "[image" in low or "placeholder" in low
```

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_topic.py -k prompt -v` (use `PYTHONPATH=. DATABASE_URL=<test-db>` per the repo's harness).

- [ ] **Step 3: Implement** — READ `backend/src/generate/prompt_builder.py` for the Books diagram wording (mermaid for flow/structure, svg for figures), then add a self-contained block to `build_topic_prompt` (do NOT import the full Books apparatus — it has request-field deps; write a trimmed, self-contained instruction consistent with the Books one). Insert into the instruction paragraph, after the "one section per subtopic" text and before "Respond with ONLY valid JSON":
```
"Where the sources support it, include a diagram that VISUALIZES what the sources describe — a "
"```mermaid block for a process, hierarchy, or relationship, or a ```svg block for a labeled or "
"illustrative figure. Hold diagrams to the same bar as the prose: invent nothing beyond the "
"sources; if a diagram would need facts the sources do not establish, omit it. Put the fenced "
"diagram inline in the relevant section's body. NEVER write \"[IMAGE: ...]\" or a camera emoji as "
"a placeholder — produce an actual ```mermaid/```svg diagram, or write text only."
```
Keep the section-per-subtopic structure + the JSON schema example unchanged (diagrams live inside `body`).

- [ ] **Step 4: Run tests + ruff** — `cd backend && python -m pytest tests/test_trust_topic.py -v`; ruff clean from repo root.

- [ ] **Step 5: Commit.**
```bash
git add backend/src/trust/topic_prompt.py backend/tests/test_trust_topic.py
git commit -m "feat(trust): per-topic prompt authors grounded mermaid/svg diagrams, bans placeholders (visuals T1)"
```

---

### Task 2: Topic viewer renders diagrams via the reader pipeline

**Files:**
- Create: `mobile/src/lib/topicVersionToTopic.ts` (a `topicVersion→GeneratedTopic` builder) — OR export the per-topic builder from `topicsToBook.ts` and reuse it
- Modify: `mobile/app/trust/topic-version/[id].tsx`
- Test: `mobile/__tests__/screens/TopicVersionViewer.visuals.test.tsx` (new) + `mobile/__tests__/lib/topicVersionToTopic.test.ts` (new, if a new lib)

**Interfaces:**
- Consumes: `TopicVersionDetailView` (`content.sections: DraftSection[]`, `title`); `@/reader/NativeTopicReader` (`{ topic: GeneratedTopic }`).
- Produces: the topic viewer renders section bodies through `NativeTopicReader` (md + mermaid + svg + sanitize), not plain `<Text>`.

- [ ] **Step 1: Write the failing test** (`TopicVersionViewer.visuals.test.tsx`, mirror `TopicVersionViewer.test.tsx`): mock `getTopicVersion` → a `TopicVersionDetailView` whose a section `body` contains a ```svg fence (e.g. ```` ```svg\n<svg><rect/></svg>\n``` ````) and another with a ```mermaid fence; render the viewer; assert the content renders via the reader path — e.g. the raw fence text is NOT shown verbatim as a `<Text>` (it's transformed), and a rendered marker from the reader pipeline is present (assert `NativeTopicReader` is used — you may assert via a testID/role the reader div exposes, or that the sanitized figure markup/`.anim-svg`/`.mermaid` class appears on web). Also: a section body containing a legacy `[IMAGE: ...]` renders as plain text without crashing. Keep the existing title + validated-badge assertions. (READ how existing reader tests assert rendered HTML — mirror that; if the reader is web-only DOM, gate the DOM assertion to the web variant like the reader's own tests do.)

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer.visuals.test.tsx`.

- [ ] **Step 3: Implement.**
- Add `topicVersionToTopic(tv: TopicVersionDetailView): GeneratedTopic` (new `mobile/src/lib/topicVersionToTopic.ts`, or export from `topicsToBook.ts` the per-topic builder it already uses): `{ topicId: tv.id, title: tv.title, lesson: <LessonOutput with topic: tv.title, empty synopsis/objectives/takeaways/further_reading, sections: tv.content.sections.map(s => ({ heading: s.heading, body_markdown: s.body })) >, generatedAt: <a timestamp or "" — match GeneratedTopic's required field> }`. Reuse the EXACT lesson shape `topicsToBook`/`artifactToBook` produce (read them).
- In `topic-version/[id].tsx`: replace the `content.sections.map(<Text>)` render with `<NativeTopicReader topic={topicVersionToTopic(topicVersion)} />` (import from `@/reader/NativeTopicReader`). Keep the title, validated badge, and approve/withdraw controls around it. Remove the now-dead per-section `<Text>` styles if unused.
- Do NOT add any sanitize/markdown logic here — it's all inside `NativeTopicReader` → `renderTopicToSafeHtml`.

- [ ] **Step 4: Run test + full TopicVersionViewer suite + tsc** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer && npx tsc --noEmit`. The C2b/C2c viewer tests (title, validated badge, approve/withdraw) must stay green — if one asserted a section `<Text>` that's now inside the reader render, update it to assert the rendered content instead (note in report; don't weaken the approve/withdraw behavior assertions).

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/lib/topicVersionToTopic.ts "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__/screens/TopicVersionViewer.visuals.test.tsx mobile/__tests__/lib/topicVersionToTopic.test.ts 2>/dev/null
git commit -m "feat(trust): topic viewer renders diagrams via the reader pipeline (visuals T2)"
```

---

### Task 3: Export — diagrams survive assembly into the book

**Files:**
- Test: `mobile/__tests__/lib/topicsToBook.test.ts` (extend)

**Interfaces:**
- Consumes: `topicsToBook` (already maps section `body` → `body_markdown` verbatim).

- [ ] **Step 1: Write the test** — extend `topicsToBook.test.ts`: a `topicSections` entry whose `body` contains a ```svg (and a ```mermaid) fence → assert the assembled Book's `content[topicId].lesson.sections[0].body_markdown` contains the fence verbatim (diagrams flow into the exported book unchanged).

- [ ] **Step 2: Run** — `cd mobile && npx jest __tests__/lib/topicsToBook.test.ts` (should PASS with no code change — `topicsToBook` already passes `body`→`body_markdown` untouched; this guards it). If it fails, `topicsToBook` is mangling the body — fix it to pass through verbatim.

- [ ] **Step 3: Verify the compiler renders it (note, not code)** — the compiler already renders ```mermaid/```svg for Books (see `compiler/src/mermaid.ts` + the SVG handling). Confirm by inspection that the per-topic book (same lesson shape) goes through the same path; note in the report that a manual EPUB/PDF export of a diagram-bearing topic is the end-to-end check (no compiler code change expected).

- [ ] **Step 4: Commit.**
```bash
git add mobile/__tests__/lib/topicsToBook.test.ts
git commit -m "test(trust): diagrams survive topicsToBook into the exported book (visuals T3)"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_topic.py -v`; ruff clean.
- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green + clean.
- [ ] Manual (local): regenerate a topic whose sources warrant a figure → the viewer shows a rendered diagram (not `[IMAGE:]` text); Publish → the exported EPUB/PDF shows the diagram.
- [ ] PR body: backend prompt (T1) → **prod backend refresh**; mobile viewer (T2) → **web redeploy**. No migration. Old text-only drafts still render (markdown).

## Self-Review

- **Spec coverage:** grounded diagram prompt + placeholder ban (T1) · in-app render via reader pipeline + sanitize (T2) · export-survives + compiler renders (T3). Raster/photo generation + retrofit correctly excluded.
- **Type consistency:** `topicVersionToTopic` returns the `GeneratedTopic` shape `NativeTopicReader` (T2) consumes = the shape `topicsToBook` builds; `DraftSection.body`→`body_markdown` mapping identical across T2 (viewer) and T3 (export).
- **Placeholders:** none — the prompt block + the render swap are concrete; the reuse points name real modules.
- **Sanitize/ADR-001:** model SVG only ever reaches the DOM through `renderTopicToSafeHtml`'s sanitize pass; no key on this path; no second renderer introduced.
