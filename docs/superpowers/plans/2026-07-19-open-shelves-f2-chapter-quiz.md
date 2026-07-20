# Open Shelves F2 — Chapter Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** From an imported book's chapter, generate an interactive quiz grounded in that chapter's own text and render it in the reader — the "why import" payoff.

**Architecture:** Extend the existing `/generate` job pipeline with a **source-grounded quiz mode** (new prompt + new validated `QuizOutput` schema — server-side quiz generation is new); mobile extracts the chapter's plaintext, submits it, stores the returned `QuizSet` as a device-local companion keyed by chapterId (chapter text untouched), and renders it with the existing `renderQuizzes` block.

**Tech Stack:** FastAPI + pydantic (`wegofwd_llm.conformance.generate_validated`), the Celery/Redis job pipeline, React Native + Expo, the existing `QuizSet` renderer.

## Global Constraints

- **Branch: `feat/open-shelves`** (LOCALHOST-ONLY R&D). Dev backend only — no production deploy this slice.
- **Reuse, don't rebuild:** the mobile `QuizSet` type + `renderQuizzes` (`mobile/src/reader/topicHtml.ts:70`) render the quiz; the job queue + BYOK/managed key handling + ADR-001 shred + `generate_validated` retry loop are reused. No client-direct-to-LLM call; no new key path.
- **F1 read-only invariant preserved:** `ImportedChapter.html` is never modified; the quiz is a separate companion.
- **No new network surface:** plaintext is extracted from already-stored chapter bytes; nothing is fetched from the book's origin (F1's no-network guarantee holds).
- **No live LLM in CI:** backend tests mock the Anthropic call; mobile tests mock the backend.
- **Source-text cap:** the chapter plaintext sent to the LLM is capped (default 12000 chars); over-cap truncates with a UI hint.
- **Quiz size default:** 5 questions per chapter.

---

## Task 1: Backend — source-grounded quiz generation

**Files:**
- Create: `backend/src/generate/quiz_schema.py` (the `QuizOutput` pydantic schema)
- Create: `backend/src/generate/quiz_prompt.py` (`build_quiz_prompt`)
- Modify: `backend/src/generate/schemas.py` (`GenerateRequest`: add `source_text`; allow `format="quiz"`)
- Modify: `backend/src/generate/tasks.py` (branch on quiz format → quiz prompt + validate `QuizOutput`)
- Test: `backend/tests/test_generate_quiz.py`

**Interfaces:**
- Produces: a `/generate` job with `format="quiz"` + `source_text` returns (via poll) a JSON `QuizOutput` = `{ set_title: str, questions: [{ question_id, question_text, question_type: "multiple_choice", options: [{ option_id, option_text, is_correct }], explanation }], total_questions }` — matching the mobile `QuizSet`/`QuizQuestion`/`QuizOption` types (`mobile/src/types/book.ts`; read them to mirror field names exactly).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_generate_quiz.py` — mock the LLM to return a valid quiz JSON, assert the worker validates + returns it; a second test feeds schema-invalid JSON then valid, asserting the `generate_validated` retry path is taken; a third asserts the lesson path is unchanged when `format="lesson"`. Mirror the existing `backend/tests/` generation tests (mocked Anthropic, fakeredis) — read one (e.g. `test_generate*.py`) for the fixtures.

- [ ] **Step 2: Run it → fail** (`format="quiz"` unhandled). `cd backend && python -m pytest tests/test_generate_quiz.py -q`

- [ ] **Step 3: Add the `QuizOutput` schema**

`backend/src/generate/quiz_schema.py` — pydantic models mirroring the mobile `QuizSet` exactly (field names must match so the app renders without mapping): `QuizOptionOut{option_id:str, option_text:str, is_correct:bool}`, `QuizQuestionOut{question_id:str, question_text:str(min_length=1), question_type:Literal["multiple_choice"], options:list[QuizOptionOut] (2..6), explanation:str}`, `QuizOutput{set_title:str, questions:list[QuizQuestionOut] (1..10), total_questions:int|None}`. (Read `mobile/src/types/book.ts` `QuizSet`/`QuizQuestion`/`QuizOption` and match field names/optionality precisely; adjust the above if the mobile names differ.)

- [ ] **Step 4: Add the grounded-quiz prompt**

`backend/src/generate/quiz_prompt.py` — `build_quiz_prompt(source_text: str, n_questions: int = 5) -> str`. The prompt: "You are writing a reading-comprehension quiz. Using ONLY the passage below, write {n} multiple-choice questions that a reader could answer from the passage. Each question: 4 options, exactly one correct, and an `explanation` that quotes/paraphrases the supporting sentence. Do NOT use outside knowledge; do NOT ask about anything not in the passage. Output JSON matching this schema: {schema}. PASSAGE: <<<{source_text}>>>." Reuse the universal JSON-output formatting discipline from `prompt_builder.py` where applicable.

- [ ] **Step 5: Wire the request + worker**

- `schemas.py`: add `source_text: str | None = Field(default=None, max_length=16000)` to `GenerateRequest`; ensure `OutputFormat` permits `"quiz"`; add a `model_validator` requiring `source_text` when `format=="quiz"` (and that `topic` may be a short label like the chapter title).
- `tasks.py`: where it currently calls `build_lesson_prompt` + validates `LessonOutput`, branch: `if req.format == "quiz": prompt = build_quiz_prompt(req.source_text, ...); schema = QuizOutput` else the existing lesson path. Reuse `generate_validated` (same retry loop) with the chosen schema. Leave key encryption/shred/job-status untouched.

- [ ] **Step 6: Run → pass; then full backend suite + coverage gate**

`cd backend && python -m pytest tests/test_generate_quiz.py -q && python -m pytest -q` (existing generation tests must still pass; 70% coverage gate holds).

- [ ] **Step 7: Commit**
```bash
git add backend/src/generate/quiz_schema.py backend/src/generate/quiz_prompt.py backend/src/generate/schemas.py backend/src/generate/tasks.py backend/tests/test_generate_quiz.py
git commit -m "feat(generate): source-grounded quiz mode (format=quiz + source_text)

New QuizOutput schema + grounded-quiz prompt; /generate accepts source_text and,
when format=quiz, produces a QuizSet answerable only from that text. Reuses the
conformance retry loop + key handling. Lesson path unchanged. (Open Shelves F2)"
```

---

## Task 2: Mobile — trigger, generate, store the chapter quiz

**Files:**
- Modify: `mobile/src/api/client.ts` (`GenerateRequest` type: add `source_text?`, allow `format:"quiz"`)
- Create: `mobile/src/openshelves/chapterText.ts` (`chapterPlainText(chapter): string` — strip + cap)
- Create: `mobile/src/hooks/useGenerateChapterQuiz.ts` (submit + poll → `QuizSet`)
- Modify: `mobile/src/types/book.ts` (`Book.chapterQuizzes?: Record<string, QuizSet>`)
- Modify: `mobile/src/storage/bookStore.ts` (persist `chapterQuizzes` — likely already round-tripped if it's on `Book`; verify)
- Test: `mobile/__tests__/openshelves/chapterQuiz.test.ts`

**Interfaces:**
- Consumes: Task 1's `format:"quiz"` + `source_text`; `submitGenerate`/`pollUntilDone`; `ImportedChapter`; `QuizSet`.
- Produces: `useGenerateChapterQuiz()` → `{ generate(bookId, chapterId), status }`; stores `QuizSet` at `book.chapterQuizzes[chapterId]` without touching `chapter.html`.

- [ ] **Step 1: Write the failing test** — `chapterPlainText` strips HTML + caps at 12000 chars; `useGenerateChapterQuiz` calls `submitGenerate` with `format:"quiz"` + the chapter's plaintext as `source_text`, and on success writes `book.chapterQuizzes[chapterId]` while `book.chapters[chapterId].html` is byte-unchanged. Mock `submitGenerate`/`pollUntilDone` (return a `QuizSet`) and `bookStore`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Plaintext extraction** — `chapterPlainText(chapter: ImportedChapter): string`: strip tags from `chapter.html` (reuse `toPlainText` from `@/openshelves/normalize`, or a `.replace(/<[^>]+>/g," ")` + entity-decode via the existing util — NOT a new sanitizer), collapse whitespace, cap at `MAX_QUIZ_SOURCE = 12000`. Return `{ text, truncated }` or expose a `truncated` flag for the UI hint.

- [ ] **Step 4: `GenerateRequest` type** — add `source_text?: string` and permit `format?: "lesson" | "quiz"` in the mobile `GenerateRequest` (`client.ts`). `submitGenerate` already posts the body verbatim — no change beyond the type.

- [ ] **Step 5: `useGenerateChapterQuiz`** — mirror `mobile/src/hooks/useGenerateTopic.ts` (read it): load the book, build the request `{ topic: chapter.title, level: <a sensible default>, format: "quiz", source_text: chapterPlainText(chapter).text }`, `submitGenerate` → `pollUntilDone` → the returned `QuizSet`; write it to `book.chapterQuizzes[chapterId]` and `saveBook`. Guard `IS_DEMO` (throw the demo message). Surface status (idle/generating/error) like the topic hook.

- [ ] **Step 6: Storage** — add `chapterQuizzes?: Record<string, QuizSet>` to `Book`; confirm `saveBook`/`loadBook` round-trip it (they serialize the whole `Book`, so likely free — add a test asserting a saved+loaded book preserves `chapterQuizzes`).

- [ ] **Step 7: Run → pass; guard** `cd mobile && npx jest __tests__/openshelves/chapterQuiz.test.ts && npx tsc --noEmit`

- [ ] **Step 8: Commit** `feat(open-shelves): generate + store a source-grounded chapter quiz (F2)`

---

## Task 3: Mobile — trigger UI + render the quiz in the reader

**Files:**
- Modify: `mobile/app/book/chapter/[bookId]/[chapterId].tsx` (the F1 read-only chapter screen — add the "Make a quiz" action + render the stored quiz)
- Modify: `mobile/src/components/LessonRenderer.tsx` or the chapter reader (render a standalone `QuizSet` via the existing `renderQuizzes` path)
- Help: `mobile/src/help-content/*` — add a topic for the feature (DoD coverage gate)
- Test: `mobile/__tests__/app/chapter-quiz.test.tsx`

**Interfaces:** Consumes `useGenerateChapterQuiz` (Task 2) + `book.chapterQuizzes` + the existing quiz renderer.

- [ ] **Step 1: Write the failing test** — the chapter screen shows a "Make a quiz from this chapter" control (native, non-demo); pressing it calls `useGenerateChapterQuiz`; once `book.chapterQuizzes[chapterId]` exists, the quiz renders (assert a question's text appears); in a demo build the control is absent/disabled.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Render a standalone QuizSet** — the reader renders topics via `renderTopicToSafeHtml`/`buildTopicHtml`, which include `renderQuizzes(topic.quizSets)`. For a chapter quiz, render the `QuizSet` through the SAME path — either wrap it as `{ quizSets: [quiz] }` into the existing topic renderer, or add a thin `renderChapterQuiz(quiz)` that calls `renderQuizzes([quiz])` and goes through the chapter sanitize boundary (`renderChapterToSafeHtml` web / `buildChapterHtml` native — the quiz is model markdown, so it MUST pass the sanitizer like any rendered content). Reuse; do not hand-render quiz HTML.

- [ ] **Step 4: Trigger UI** — on the chapter screen, a "Make a quiz from this chapter" button (native only, `!IS_DEMO`), with a generating spinner + the truncation hint when the chapter was capped, and an error surface (mirror the topic screen's generate affordance). After success, the quiz renders below the chapter text.

- [ ] **Step 5: Help topic** — add the feature key + a Help topic (DoD coverage gate: `mobile/__tests__/help/coverage.test.ts`).

- [ ] **Step 6: Run → pass; full guard** `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`

- [ ] **Step 7: Commit** `feat(open-shelves): chapter-quiz trigger + in-reader render + Help (F2)`

---

## After all tasks
- **Manual moat check (device or web):** import a real PD EPUB → open a chapter → "Make a quiz" → confirm a sensible, source-grounded quiz renders interactively. This is the "why import" demo; a reviewer/manual pass validates grounding fidelity (R1) — not an automated gate.
- **Whole-branch review** (subagent-driven final review) over the F2 range.
- **Ledger:** F2 stays on `feat/open-shelves` (localhost-only). Shipping F1+F2+backend to prod remains a separate later effort.

## Self-Review (completed)
- **Spec coverage:** G1 generate+render quiz → T1+T2+T3; G2 reuse pipeline/key → T1 (generate_validated, no new key path); G3 reuse QuizSet+renderer → T2 type, T3 renderQuizzes; G4 read-only → T2 (chapter.html byte-unchanged test). §4.1 plaintext/cap → T2 S3; §4.2 backend mode → T1; §4.3 trigger/store/render → T2+T3; §4.4 security (quiz through sanitizer) → T3 S3. OQ1 cap=12000, OQ2 n=5 → Global Constraints.
- **Placeholder scan:** the mirrored parts (hook, tasks.py branch, renderer) point at the exact existing file to mirror + the concrete delta; the novel parts (schema, prompt, plaintext cap, storage) are specified concretely. Field names are pinned to the mobile `QuizSet` (read it to match).
- **Consistency:** `format:"quiz"`, `source_text`, `QuizOutput`↔`QuizSet` field-name parity, `book.chapterQuizzes[chapterId]`, `chapterPlainText`, `useGenerateChapterQuiz`, cap `12000`, `n=5` — consistent across tasks.
