# Per-topic visuals (SVG/Mermaid diagrams) — Design

**Status:** Approved (brainstorming, 2026-08-09). Follows the closed Projects arc. Fixes the
"📷 [Image: …] placeholder but no image" gap in generated per-topic drafts.

## Problem

The per-topic generator emits **text-only** markdown; the topic viewer renders section bodies as
plain `<Text>`. When a source asks for images, the grounded model surfaces the request as literal
`[IMAGE: …]` / 📷 placeholders that nothing fills. Meanwhile the **Books** path already generates,
sanitizes, and renders real diagrams (```mermaid / ```svg). Bring that treatment to per-topic.

## Goal

Per-topic drafts contain **real, grounded diagrams** (```mermaid for flow/structure, ```svg for other
visuals) that render in the in-app topic viewer AND in the exported book — with the per-topic expert
validation as the trust backstop. No more `[IMAGE:]` placeholders.

## Locked decisions (brainstorming 2026-08-09)

1. **Full pipeline:** generate diagrams (prompt) · render in the in-app topic viewer (the new work) ·
   render in the exported book (compiler — already works for Books).
2. **Diagram grounding = same bar as the prose** ("visualize what the sources establish; invent
   nothing"); the model MAY draw a diagram when the sources support it, else omit. The **per-topic
   expert validation** vets diagrams like any content (withdraw if wrong). Reuse the Books diagram
   guidance.
3. **Ban `[IMAGE: …]` / 📷 placeholders** outright — a real diagram or nothing.
4. **Reuse the Books/reader machinery** end to end: the reader's md→HTML→**sanitize**→enhance pipeline
   (`@/reader/*`) for in-app render; the compiler's existing diagram rendering for export.

## Architecture

### Generation — `backend/src/trust/topic_prompt.py` (T1)

Add a diagram/formatting instruction to the topic prompt (reuse the Books guidance in
`backend/src/generate/prompt_builder.py` — the universal formatting block + diagram-role contract:
```mermaid for flowcharts/data-structure diagrams; ```svg for other visuals). Framed for grounding:
- *"Where the sources support it, include a diagram that VISUALIZES what the sources describe — a
  ```mermaid block for a process/structure, or a ```svg block for a labeled/illustrative figure.
  Hold diagrams to the same bar as the prose: invent nothing beyond the sources; if a diagram would
  require facts the sources don't establish, omit it."*
- *"Never emit `[IMAGE: …]` or 📷 placeholders — produce an actual diagram or write text only."*
Keep the section-per-subtopic structure + the `{sections:[{heading,body,sources}]}` schema (the
diagram fences live inside `body`). `_MAX_TOKENS` stays 16384 (diagrams add tokens — already generous).

### In-app render — `mobile/app/trust/topic-version/[id].tsx` (T2, the main new work)

Replace the plain-`<Text>` section render with the **reader's renderer**:
- Build a `GeneratedTopic` from the topic_version: `{ topicId: id, title, lesson: <LessonOutput with
  sections = content.sections.map(s => ({heading: s.heading, body_markdown: s.body}))> }` — the same
  per-topic shape `topicsToBook` already constructs (extract a tiny shared helper
  `topicVersionToGeneratedTopic` or reuse `topicsToBook`'s per-topic builder).
- Render `<NativeTopicReader topic={builtTopic} />` (from `@/reader/NativeTopicReader`) in place of the
  `sections.map(<Text>)`. This inherits: `topicHtml.renderLesson` (md → ```mermaid/```svg via
  `reader/markdown.ts`) → `renderTopicToSafeHtml` (ONE DOMPurify sanitize pass — the boundary) →
  `<div dangerouslySetInnerHTML>` + `enhanceReaderNode` (runs Mermaid + KaTeX). Web + native both
  covered (`NativeTopicReader.web.tsx` / `.tsx`).
- Keep the title, validated badge, and the approve/withdraw controls (C2c) around the rendered body.
- **Sanitize:** model-authored SVG passes through the reader's `sanitizeFragment` (scripts stripped) —
  the same boundary Books use; no new sink. (Mermaid renders client-side post-sanitize, same accepted
  posture as the reader.)

### Export — `topicsToBook` + compiler (T3, mostly free)

`topicsToBook` maps each section `body` → `body_markdown` verbatim, so ```mermaid/```svg fences flow
into the assembled Book's lesson bodies unchanged; the **compiler already renders** them into EPUB/PDF
(the Books path). T3 = confirm the fences survive assembly (a `topicsToBook` test) + verify the
compiler output renders a diagram (reuse an existing compiler diagram fixture/test if present, else a
manual export check noted in the report).

## Reuse map

- `backend/src/generate/prompt_builder.py` diagram/formatting guidance → the topic prompt (T1).
- `@/reader/NativeTopicReader` (+ `topicHtml`/`renderContent`/`sanitize`/`enhance`, `reader/markdown.ts`)
  → the topic viewer's body render (T2) — md + mermaid + svg + sanitize, unchanged.
- `topicsToBook`'s per-topic `GeneratedTopic`/lesson builder → the viewer's `builtTopic` (T2) and the
  export path (T3) — one shape.
- The compiler's existing diagram rendering → the exported per-topic book (T3, free).

## Testing

- **Backend (T1):** `build_topic_prompt` includes the diagram guidance (mermaid + svg), the
  "visualize what the sources establish / invent nothing" grounding, and the explicit ban on
  `[IMAGE:]`/placeholders; the section-per-subtopic schema example unchanged.
- **Mobile (T2):** the topic viewer renders a section body containing a ```svg (and a ```mermaid) block
  via `NativeTopicReader` — assert the reader renderer is used (not raw `<Text>`), and (web) that the
  sanitized figure is present / a raw `<script>` inside the SVG is stripped (reuse the reader's sanitize
  test vectors). A body with `[IMAGE:]` (from an OLD draft) still renders safely as text (no crash).
- **Export (T3):** `topicsToBook` preserves a ```svg/```mermaid fence into `body_markdown` (a
  section body with a fence → the assembled Book's lesson `body_markdown` contains it verbatim);
  note/verify the compiler renders it (Books fixture).

## Files

- `backend/src/trust/topic_prompt.py` (+ optionally import the shared diagram block); test
  `backend/tests/test_trust_topic.py`.
- `mobile/app/trust/topic-version/[id].tsx` (render via NativeTopicReader) + a small
  `topicVersion→GeneratedTopic` helper (new lib or reuse topicsToBook's builder); tests under
  `mobile/__tests__/`.
- `mobile/src/lib/topicsToBook.ts` (if extracting the per-topic builder for reuse); test
  `mobile/__tests__/lib/topicsToBook.test.ts` (fence-survives assertion).

## Decomposition

- **T1 — prompt** (backend): grounded diagram guidance + ban placeholders.
- **T2 — in-app viewer render** (mobile): topic viewer body via `NativeTopicReader` (build a
  GeneratedTopic from sections); sanitize inherited.
- **T3 — export verify** (small): fences survive `topicsToBook` → compiler renders (test + note).

## Rollout

Backend (T1) → **prod backend refresh** (no migration). Mobile (T2) → **web redeploy** (+ APK later).
T3 is verification (may ship with T2). Existing text-only drafts still render fine (markdown).

## Out of scope

- Raster/photo generation (no text-to-image); diagrams are vector (mermaid/SVG) only — on-brand
  ([[project_animated_visuals_svg]]). Per-topic image *attachments* (that's the Books media path).
  Retrofitting diagrams into already-generated drafts (regenerate the topic to get them).

## Global constraints

Diagrams grounded same-bar-as-text; expert-validation backstop. ADR-001: no api key on render/export.
Model-authored SVG MUST pass the reader's sanitize boundary (`sanitizeFragment`) — never inject raw.
`useThemedStyles`; no color-literal test asserts. Reuse the reader/compiler renderers — do NOT write a
second markdown/diagram renderer ([[project_reader_one_renderer]]).
