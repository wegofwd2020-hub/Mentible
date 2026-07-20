# Open Shelves F2 — per-chapter quiz from imported books (the payoff)

**Date:** 2026-07-19
**Status:** Approved (brainstorm), pending plan
**Branch:** `feat/open-shelves` (LOCALHOST-ONLY R&D — not for production ship this slice)
**Depends on:** F1 imported-book reading (`docs/superpowers/specs/2026-07-14-imported-book-reading-design.md`, complete on this branch).
**Related:** [[project_open_shelves_no_read_path]] (F1→F2→F3), [[project_product_vision_multimodal_library]] (the reader-is-the-moat USP), ADR-028 (catalog client), ADR-029 (grounding — this is a lightweight, in-request cousin, NOT the RAG tier).

## 1. Problem — F1 made imported books readable, but not yet *useful*

F1 parses a downloaded EPUB into our reader and keeps each chapter's text in the store. Today a user can
*read* an imported public-domain book — but so can any EPUB reader. There is no reason to import into
Mentible specifically. F2 is "the payoff": **what Mentible does with an imported book that a plain EPUB
reader can't** — turn a chapter into an **interactive quiz**, grounded in that chapter's own text,
rendered in our reader. That is the honest answer to "why import?" and the first taste of the
reader-is-the-moat USP (a plain EPUB reader cannot render an interactive, source-grounded quiz).

## 2. The technical crux — source-grounded generation is new

The existing `/generate` pipeline is **topic-scoped**: it takes `topic: string` + level/depth and the
LLM generates a **lesson** (`LessonOutput`) from *its own* knowledge. It does **not** accept source text,
and it does **not** produce quizzes server-side (quiz *rendering* + the `QuizSet` type exist in the
mobile app for migrated books, but the live generate path emits lessons only). F2 therefore introduces
**two** new backend capabilities, plus mobile wiring:

- **(a) Quiz generation** — a prompt + a validated `QuizSet` output schema (server-side quiz generation
  does not exist yet).
- **(b) Source-grounding** — the request carries the chapter's plaintext; the prompt instructs the model
  to produce questions **answerable only from that text**, not from outside knowledge.

The mobile `QuizSet` type and the interactive quiz **renderer are reused** (not rebuilt).

## 3. Goals / non-goals

**Goals**
- G1. From an imported chapter, generate an interactive `QuizSet` grounded in that chapter's text, on
  demand, and render it in the reader.
- G2. Reuse the existing generation infrastructure (job queue, BYOK/managed key handling + ADR-001 shred
  discipline, poll flow) — no new key path, no client-direct-to-LLM call.
- G3. Reuse the mobile `QuizSet` type + the interactive quiz renderer.
- G4. Preserve F1's read-only invariant: the imported chapter text is never edited; the quiz is a
  **separate companion** artifact.

**Non-goals**
- N1. Not a production ship (localhost-only R&D on `feat/open-shelves`; dev backend).
- N2. Not whole-book study packs, study-guides, flashcards, or summaries — later expansions of this seam.
- N3. Not the ADR-029/033 RAG/library-grounding tier (persistent embeddings, cross-book retrieval). F2's
  grounding is **in-request** (this one chapter's text as context), nothing indexed or stored server-side.
- N4. Not auto-generation on import (cost/consent) — strictly on demand, per chapter.
- N5. No production backend deploy; the backend change runs on the dev backend only.

## 4. Design

### 4.1 Source text (reuse, no new sanitizer)
The chapter is stored as raw HTML (`ImportedChapter.html`, F1). Extract **plaintext** for the LLM by
stripping tags (reuse `toPlainText` / the markdown text utilities — never a second sanitizer). Apply a
**size cap** (first ~N characters/tokens); if a chapter exceeds it, truncate and surface a hint ("quiz
covers the first part of a long chapter"). The plaintext never renders — it is model input only.

### 4.2 Backend — source-grounded quiz mode
Extend the `/generate` job pipeline:
- Request gains an optional **`source_text`** (the chapter plaintext) and a **`format: "quiz"`** (or a
  `mode`) selector. When `source_text` + quiz mode are present, the job uses a **grounded-quiz prompt**
  ("write N multiple-choice questions answerable ONLY from the text below; each with options, the correct
  answer, and an explanation citing the text; do not use outside knowledge") and validates the model
  output against a new **`QuizOutput`/`QuizSet` pydantic schema** (mirroring the mobile `QuizSet`:
  `questions[]` with `question_text`, `options[]`, correct option, `explanation`). Reuse the existing
  retry-on-`ValidationError` (≤3×), key encryption/shred, and job-status/poll machinery unchanged.
- The topic-scoped lesson path is untouched (the quiz mode is additive).

### 4.3 Mobile — trigger, storage, render
- **Trigger:** a "Make a quiz from this chapter" action on F1's read-only chapter screen
  (`app/book/chapter/[bookId]/[chapterId].tsx` / `NativeChapterReader`). Tap → extract plaintext →
  `submitGenerate` with `source_text` + quiz mode → `pollUntilDone` → store. Disabled in demo builds
  (`IS_DEMO`). A short cost/consent hint ("uses your LLM key").
- **Storage (read-only preserved):** the returned `QuizSet` is stored **device-local**, keyed by
  `chapterId`, as a companion to the imported book (e.g. `book.chapterQuizzes?: Record<chapterId,
  QuizSet>` or a sibling store) — the `ImportedChapter.html` is never modified. Regenerating replaces the
  chapter's quiz.
- **Render:** reuse the existing interactive quiz renderer (the quiz block that "lights up" with local
  progress). Show the quiz on the chapter screen below the text (or a "Quiz" affordance). An imported PD
  book now carries interactive study material inside Mentible's reader — the moat demo.

### 4.4 Security / trust
- The chapter plaintext fed to the LLM is third-party PD text (fine to send to the user's own LLM via the
  established BYOK/managed path; ADR-001 shred applies as for any generation).
- The generated quiz is model-authored content → rendered through the **existing** quiz renderer, which
  already sanitizes model markdown (KaTeX/GFM) via the reader boundary. No raw HTML from the quiz.
- No new network surface: generation goes through the existing backend `/generate`; nothing is fetched
  from the imported book's origin (F1's no-network guarantee is untouched — plaintext is extracted from
  already-stored bytes).

## 5. Testing
- Backend: grounded-quiz prompt path produces schema-valid `QuizSet`; retry-on-invalid; a mocked LLM
  fixture (no live Anthropic in CI); the lesson path is unchanged (regression).
- Mobile: `submitGenerate` carries `source_text` + quiz mode; plaintext extraction from a chapter's HTML;
  the returned `QuizSet` stores keyed by chapterId without mutating `ImportedChapter.html`; the quiz
  renders via the existing renderer; demo build blocks the action.
- E2E (mock backend): from a stored imported chapter → trigger → a `QuizSet` is stored + rendered; the
  chapter text is byte-unchanged.

## 6. Open questions
- **OQ1. Source-text cap / long chapters.** First slice: a fixed character cap + truncation hint. Later:
  chunk + multi-pass. (Plan picks the cap; note it in the UI.)
- **OQ2. Quiz size.** How many questions per chapter (e.g. 5). Plan fixes a default; keep it small for cost.
- **OQ3. Managed vs BYOK cost surfacing.** First slice: the existing key path + a generic hint; no
  metering UI changes.

## 7. Risks
- **R1. Grounding fidelity.** The model may invent questions not answerable from the text. Mitigation: an
  explicit "only from the text" prompt + the explanation must cite the passage; acceptable for R&D, and a
  reviewer/manual check on a real chapter validates it. Not a correctness gate for the first slice.
- **R2. Cost on large chapters.** Bounded by the source-text cap + per-chapter on-demand (N4). No
  auto/whole-book generation.
- **R3. Localhost-only.** The backend quiz mode runs on the dev backend; F2 does not ship. Shipping F1+F2
  + the backend change to prod is a separate later effort (deferred, per the chosen base).
