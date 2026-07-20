# Native quiz-reveal parity — design

> Status: Accepted (2026-07-19). Branch: `feat/open-shelves` (localhost-only R&D;
> ships to main with the rest of Open Shelves when the feature is shipped).
> Companion follow-up to Open Shelves F2 (chapter quiz).

## Problem

The native (Android) WebView reader renders quizzes **statically**: the learner
sees the questions and options but cannot answer them. The interactive
click-to-reveal (tap an option → the question locks → the pick is graded, the
true answer highlighted, and the answer + explanation revealed) exists **only on
the web reader**, in `@/reader/quizReveal`'s `wireQuizzes`, run from
`enhanceReaderNode` after sanitization.

This gap matters because:
- **Android is the primary platform** (D3) and the demo APK is where the Open
  Shelves import→quiz moat is shown. A non-interactive quiz undercuts that demo.
- It affects **both** quiz surfaces on native — the topic quiz (`buildTopicHtml`)
  and the F2 imported-chapter quiz (`buildChapterQuizHtml`) — because both render
  through the same `htmlDocument` WebView shell.

## Goal

Native WebView quizzes become interactive with behavior **identical to the web
reader** — no more, no less. No score summary, no retry: the web model is
lock-on-first-pick, and parity means matching it.

## Non-goals (YAGNI)

- No end-of-quiz score/summary (would be new behavior, not parity — and would
  have to be added to web too).
- No per-question retry/reset (web locks on first pick).
- No shared single-source-of-truth `eval` mechanism between web and native (adds
  `eval`-from-string + CSP/eslint friction on web for a ~25-line function; the
  codebase already accepts documented in-WebView copies for the sanitizer hooks).
- No changes to `htmlChapterDocument` (pure prose chapters carry no quiz).

## Architecture

One production file changes, one test file is added.

### 1. `QUIZ_REVEAL_JS` — inlined mirror of `wireQuizzes`

Add a new template-string constant in `mobile/src/components/contentHtml.ts`, a
faithful port of `@/reader/quizReveal`'s `wireQuizzes` to a WebView-inlinable JS
string. Constraints, matching the existing `TOPIC_SANITIZE_HOOK_JS` /
`CHAPTER_SANITIZE_HOOK_JS` pattern in the same file:

- **Single quotes only** inside the string, so it nests cleanly in the outer
  template literal.
- Defines a `wireQuizzes(root)` function that reproduces the web logic exactly:
  for each `.quiz-q` under `root`, attach a delegated `click` listener on its
  `.quiz-options`; on a `.quiz-opt` click, if the question is already answered
  (`data-answered` non-empty) do nothing; otherwise set `data-answered` to the
  option's `data-oid`, add `picked` + (`correct` if `data-correct==="true"` else
  `incorrect`) to the clicked button, add `correct` to the true-correct option,
  `disabled` + remove `tabindex` on every option, and unhide the `.quiz-reveal`.
- A header comment marks it a **mirror of `@/reader/quizReveal.wireQuizzes`** and
  points at the parity test.

`QUIZ_REVEAL_JS` is **exported** from `contentHtml.ts` so the test can `eval` it.

### 2. Wire it into `htmlDocument`

In the `htmlDocument` IIFE (`mobile/src/components/contentHtml.ts`), after
`document.getElementById('root').innerHTML = clean;` and the existing KaTeX and
Mermaid passes, add:

```js
try { wireQuizzes(document.getElementById('root')); } catch (e) { /* a malformed
quiz must never blank the page — same defensive posture as the KaTeX/Mermaid
guards above */ }
```

Inject the function itself alongside the existing `DOMPURIFY_SRC` /
`TOPIC_SANITIZE_HOOK_JS` script tags:

```html
<script>${QUIZ_REVEAL_JS}</script>
```

`wireQuizzes` is **inlined, not fetched**, so — unlike KaTeX/Mermaid — it is
always defined; the `try/catch` guards only against a runtime DOM edge case, not
absence. Placement after the KaTeX/Mermaid passes mirrors the web order
(`renderMath → wireQuizzes → renderDiagrams`) closely enough; ordering does not
matter functionally (wiring only attaches listeners to `.quiz-opt` buttons, which
KaTeX/Mermaid do not touch).

### Scope of the change

`htmlDocument` only. Both `buildTopicHtml` and `buildChapterQuizHtml` route
through it, so one change covers both native quiz surfaces.
`htmlChapterDocument` is untouched.

## Testing — copy + behavioral jsdom

New file `mobile/__tests__/components/quizReveal.native.test.ts`
(`@jest-environment jsdom`), mirroring the existing web test
`__tests__/reader/quizReveal.test.ts` but exercising the **native** inlined
string:

- Build a real quiz DOM: `renderChapterQuizToHtml(quiz)` → sanitize it the same
  way the WebView will (topic sanitize path) → set as `document.body.innerHTML`.
  (Rendering through `renderChapterQuizToHtml` guarantees the test's DOM uses the
  exact `.quiz-q`/`.quiz-opt`/`data-oid`/`data-correct`/`.quiz-reveal` contract
  the production renderer emits, so a renderer change that broke the contract
  fails the test too.)
- `eval(QUIZ_REVEAL_JS)` to define `wireQuizzes` in the test scope, then call
  `wireQuizzes(document.body)`.
- Assertions, matching the web test's cases so the two copies are pinned to the
  same behavior:
  - **Non-vacuity anchor:** before any click, `.quiz-reveal` is hidden,
    `data-answered` is `""`, no `.picked` exists.
  - **Wrong pick:** clicking a wrong option sets `data-answered` to its oid, adds
    `picked`+`incorrect` to it, `correct` to the true answer, unhides
    `.quiz-reveal`, and `disabled` on every option.
  - **Correct pick:** clicking the right option adds `picked`+`correct` and
    leaves no `.incorrect` anywhere.
  - **Lock:** a second click after the first is ignored (`data-answered`
    unchanged, the later option gains no `picked`).

Because the test **executes** the inlined string, any drift between
`QUIZ_REVEAL_JS` and `wireQuizzes` shows up as a behavioral failure here (or in
the web test), not as silent divergence.

Regression: the existing `__tests__/components/contentHtml.test.ts` (native
document structure) and `__tests__/reader/quizReveal.test.ts` (web logic) must
still pass.

## Files

- **Modify:** `mobile/src/components/contentHtml.ts` — add + export
  `QUIZ_REVEAL_JS`; inject its `<script>`; call `wireQuizzes` in the
  `htmlDocument` IIFE.
- **Create:** `mobile/__tests__/components/quizReveal.native.test.ts` — behavioral
  jsdom test of the inlined string.

## Risks / notes

- **Drift** between the TS `wireQuizzes` and the JS `QUIZ_REVEAL_JS` copy: bounded
  by both having behavioral tests over the same DOM contract. Accepted, matching
  the sanitizer-hook precedent in the same file.
- **CSP:** the native topic document's CSP (#329) already allows `script-src
  'unsafe-inline'`, and `QUIZ_REVEAL_JS` is inline like the DOMPurify/hook scripts
  — no CSP change needed. It runs *after* DOMPurify, over already-sanitized DOM,
  adds no new markup, and touches only `.quiz-*` nodes the renderer emitted, so it
  does not widen the sanitize boundary.
- **Help/Definition of Done:** the interactive-quiz capability is already a
  shipped, Help-documented feature (F2). This closes a platform gap in an existing
  feature rather than adding a new user-facing feature key, so no new Help topic is
  required — but the implementation plan should confirm no existing Help copy
  claims web-only interactivity.
