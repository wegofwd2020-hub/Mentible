# Interactive quiz reveal — native web reader (fast-follow #4)

**Status:** Design approved 2026-07-11. Gates the `EXPO_PUBLIC_NATIVE_READER` (D1) flag flip.
**Scope:** web-only, additive to the native web reader (`mobile/src/reader/`). Behind the
existing off-by-default flag; no route, iframe, or native (RN) code changes.

## Background / premise correction

The resume-pin framing of this fast-follow — "the iframe reader revealed answers
interactively; the native reader ships static reveal (D6), so match it or it's a downgrade" —
is **factually wrong**. Both readers render quiz answers **statically and identically**:

- Iframe (`src/components/contentHtml.ts`, `renderQuizzes`): marks the correct option with ✓
  and always shows `Answer:` + explanation. Its only `<script>` tags are CDN loads + the render
  bootstrap — no click handler, no reveal, no "Show answer". It never had interactive reveal.
- Native (`src/reader/renderContent.ts`, `renderQuizzes`): the same static markup.

Static reveal was a deliberate decision (commit `794850a` "render quiz sets with static reveal
(spec D6)"). So there is **no downgrade** and the D1 gate as originally written is already
satisfied. This feature is therefore reframed as a **net-new enhancement**: hide the answer
until the learner commits, which is better quiz pedagogy than showing it immediately. It
applies to the **native web reader only**; the iframe stays static and is slated for retirement.

## Decisions

- **Interaction: select-an-option-then-grade.** The learner taps an option to commit; the
  reader marks it right/wrong, highlights the true-correct option, and reveals the explanation.
- **Lock on first tap.** The first tap commits: options lock (disabled), the grade + correct
  answer + explanation reveal, and it stays that way for the session. State is a single
  `data-answered` value per question.
- **Architecture: post-mount interaction pass** (Approach A), in the `enhance.ts` family —
  app-owned JS toggling classes over the already-sanitized DOM. Chosen over rendering the quiz
  as React components (Approach B) because it (1) matches the established post-mount-pass
  pattern (KaTeX, Mermaid), (2) keeps the single DOMPurify boundary intact, (3) needs no
  re-implementation of `md()` in React, and (4) the answer-in-hidden-DOM concern is neutralized
  because `display:none` content is excluded from find-in-page and text selection in all major
  browsers — so the native reader's headline features do not leak answers.

## 1. Markup contract (`renderContent.ts` → `renderQuizzes`)

Each question changes from "answer always visible" to a locked/reveal structure:

```html
<div class="quiz-q" data-answered="">
  <div class="quiz-qtext">1. …question (markdown)…</div>
  <ul class="quiz-options" role="group">
    <li><button type="button" class="quiz-opt" data-oid="A" data-correct="false"><b>A.</b> text</button></li>
    <li><button type="button" class="quiz-opt" data-oid="B" data-correct="true"><b>B.</b> text</button></li>
    …
  </ul>
  <div class="quiz-reveal" hidden>
    <div class="quiz-answer"><b>Answer:</b> B</div>
    <div class="quiz-expl">…explanation (markdown)…</div>
    <div class="difficulty">medium</div>
  </div>
</div>
```

- Options become `<button type="button">` carrying `data-oid` (the option id) and
  `data-correct` (`"true"`/`"false"`). No ✓ and no `.correct` class at render time.
- The answer, explanation, and difficulty move inside a `hidden` `.quiz-reveal` block.
- `data-answered=""` (empty string) marks the question unanswered.
- Option text stays `escapeHtml`'d; question text and explanation stay `md()`-rendered — the
  final single `sanitizeFragment` pass at the bottom of `renderTopicToSafeHtml` is unchanged.
- Multiple quiz sets and the `Set N` heading are unchanged; every question is independent.

## 2. Interaction module (`src/reader/quizReveal.ts`, web-only)

```
export function wireQuizzes(node: HTMLElement): void
```

For each `.quiz-q` under `node`, attach ONE delegated `click` listener on its `.quiz-options`.
On a click whose target resolves (via `closest`) to a `.quiz-opt` button:

1. If the owning `.quiz-q` has a non-empty `data-answered` → return (locked).
2. Read the tapped button's `data-oid` and `data-correct`.
3. Set the question's `data-answered` to the tapped `data-oid`.
4. Add `.picked` and (`.correct` if `data-correct === "true"`, else `.incorrect`) to the tapped
   button.
5. Add `.correct` to the true-correct button (`[data-correct="true"]`) if not already the tapped
   one.
6. Set `disabled` and remove `tabindex` on every `.quiz-opt` in the question (lock).
7. Remove the `hidden` attribute from the question's `.quiz-reveal`.

Guards: a `.quiz-q` with no `[data-correct]` options (malformed) is skipped in step 5 but still
reveals; a click outside a `.quiz-opt` is ignored. **No module-level state** — everything lives
in the DOM, so a remount or topic change (which React re-injects) resets the quiz, which is the
intended behavior.

## 3. Wiring (`enhance.ts`)

`enhanceReaderNode(node)` calls `wireQuizzes(node)` alongside `renderMath(node)` and
`void renderDiagrams(node)`. No explicit teardown: the listeners are attached to nodes that
React discards wholesale when `dangerouslySetInnerHTML` re-runs on a new topic, so they are
garbage-collected with those nodes. The existing cancellation cleanup for the async Mermaid
pass is unchanged.

## 4. Styling (`readerStyles.ts`, every rule scoped under `.mentible-reader`)

New rules:
- `.quiz-opt` — button reset to look like the old option row: full-width, left-aligned,
  inherits font/color, `cursor: pointer`, a subtle hover background.
- `.quiz-opt.correct` — success color, `font-weight: 600`, `::after { content: " ✓"; }`.
- `.quiz-opt.incorrect` — error color, `::after { content: " ✗"; }`.
- `.quiz-opt[disabled]` — `cursor: default`, no hover affordance.

`.quiz-reveal` needs no explicit rule to hide (the `hidden` attribute → `display:none`); once
`hidden` is removed it lays out as a normal block. Existing `.quiz-answer`, `.quiz-expl`,
`.difficulty`, `.quiz-options`, `.quiz-q` rules are kept (with the `list-style`/padding on
`.quiz-options` and the button reset making the `<li><button>` render like the old `<li>`).
The coverage test's ">40 scoped rules, all under `.mentible-reader`" invariant remains true.

## 5. Sanitize config (`sanitize.ts`)

**No change.** Verified against the current `SANITIZE_CONFIG`: `<button>`, `class`, `data-oid`,
`data-correct`, `role`, `tabindex`, `aria-*`, and `hidden` all survive `sanitizeFragment`
untouched. The `disabled` attribute is applied post-mount by `quizReveal.ts`, not through
sanitization, so it is unaffected by the config.

## 6. Testing

- **`__tests__/reader/quizReveal.test.ts`** (jsdom):
  - wrong pick → question `data-answered` set, tapped button `.incorrect`, true-correct button
    `.correct`, all options `disabled`, `.quiz-reveal` no longer `hidden`.
  - correct pick → tapped button `.correct` (and is the true-correct), reveal shown.
  - second click after answering is ignored (locked): state and classes unchanged.
  - a freshly rendered, **un**wired quiz DOM has `.quiz-reveal[hidden]` and no state classes
    (non-vacuity: the reveal only happens because `wireQuizzes` ran).
- **`__tests__/reader/renderContent.test.ts`**: update the quiz assertions to the new contract —
  options are `<button>`s with `data-correct`, the `.quiz-reveal` block carries `hidden`, and the
  `Answer:` text is inside that hidden block (not in the always-visible markup).
- **`__tests__/reader/enhance.test.ts`**: `enhanceReaderNode` invokes `wireQuizzes` (mock, same
  pattern as the KaTeX/Mermaid mocks).
- **`__tests__/reader/NativeTopicReader.test.tsx`**: the existing DOMParser security assertion
  must still pass over a quiz topic — buttons and `data-*` are inert.

## 7. Scope / non-goals

- **Web-only.** No changes to the native (RN) reader stub, the iframe/WebView path, or routing.
  The iframe quiz stays static; the native reader now exceeds it. This does not violate D5
  (which forbids the native reader being *worse* than the iframe) and the iframe is slated for
  retirement; the divergence is flag-gated.
- **Ephemeral.** No score aggregation and no persistence across remount or topic change.
  Durable per-learner progress belongs to the separate free reader app (product north-star), not
  this authoring app.
- **A11y baseline.** Native `<button>` semantics give keyboard and screen-reader access;
  `aria-disabled` on lock and focus management are baseline, not gold-plated.
- **Help deferred to the flag flip.** Per the Definition of Done, a user-facing feature needs an
  in-app Help topic + a `FEATURES` key. Because this feature is dormant behind the off-by-default
  flag, the Help entry lands in the D1 flag-flip PR (which is what makes it user-facing), not
  here — so the coverage gate is not tripped by an orphaned `FEATURES` key.

## Files

```
EDIT  mobile/src/reader/renderContent.ts     new quiz markup contract (§1)
NEW   mobile/src/reader/quizReveal.ts         wireQuizzes post-mount pass (§2)
EDIT  mobile/src/reader/enhance.ts            call wireQuizzes (§3)
EDIT  mobile/src/reader/readerStyles.ts       .quiz-opt states (§4)
NEW   mobile/__tests__/reader/quizReveal.test.ts
EDIT  mobile/__tests__/reader/renderContent.test.ts
EDIT  mobile/__tests__/reader/enhance.test.ts
```
