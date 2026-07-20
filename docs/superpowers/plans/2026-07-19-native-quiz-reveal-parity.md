# Native quiz-reveal parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native (Android WebView) quizzes interactive — tap to answer, lock, grade, reveal — identical to the web reader, covering both native topic quizzes and F2 chapter quizzes.

**Architecture:** Add an inlined JS mirror of web `wireQuizzes` (`QUIZ_REVEAL_JS`) to `contentHtml.ts`, inject it as a `<script>` in the `htmlDocument` shell, and call `wireQuizzes(root)` in that document's post-render IIFE (after DOMPurify + KaTeX/Mermaid). Both `buildTopicHtml` and `buildChapterQuizHtml` route through `htmlDocument`, so one change covers both. A behavioral jsdom test executes the inlined string to pin it against the web copy.

**Tech Stack:** TypeScript, React Native WebView (in-page ES5 JS string), Jest + jsdom.

**Spec:** `docs/superpowers/specs/2026-07-19-native-quiz-reveal-parity-design.md`

## Global Constraints

- **`QUIZ_REVEAL_JS` is a WebView-inlined string nested inside a template literal.** It MUST use **single quotes only** and **ES5-safe syntax** (`var` / `function`, no arrow functions, no `const`/`let`, no template literals, no optional chaining) — the same discipline as the existing `TOPIC_SANITIZE_HOOK_JS` in the same file.
- **Behavior is an EXACT mirror of `@/reader/quizReveal`'s `wireQuizzes`** — lock-on-first-pick, grade the pick, highlight the true answer, disable all options, unhide `.quiz-reveal`. No score, no retry, no extra behavior.
- **Change `htmlDocument` only.** Do NOT touch `htmlChapterDocument` (pure prose chapters carry no quiz).
- **No CSP change.** The topic document's #329 CSP already allows `script-src 'unsafe-inline'`. The script runs after DOMPurify, over already-sanitized DOM, injects no markup.
- **Branch:** `feat/open-shelves`. Full suite + `tsc --noEmit` + `eslint .` must stay green.

---

### Task 1: Add + export `QUIZ_REVEAL_JS` with a behavioral jsdom test

**Files:**
- Modify: `mobile/src/components/contentHtml.ts` (add + export the constant)
- Test: `mobile/__tests__/components/quizReveal.native.test.ts` (create)

**Interfaces:**
- Produces: `export const QUIZ_REVEAL_JS: string` from `@/components/contentHtml` — a JS source string that, when evaluated, defines `function wireQuizzes(root)`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/quizReveal.native.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
// The NATIVE half of quiz-reveal parity: `QUIZ_REVEAL_JS` is the WebView-inlined
// mirror of `@/reader/quizReveal`'s `wireQuizzes`. jest can't run the WebView, so
// this evaluates the string directly and drives the SAME behavioral cases as the
// web test (`__tests__/reader/quizReveal.test.ts`) — drift between the two copies
// shows up as a failure here.
import { QUIZ_REVEAL_JS } from "@/components/contentHtml";
import { renderChapterQuizToSafeHtml } from "@/reader/renderContent";
import type { QuizSet } from "@/types/book";

// Build the real `function wireQuizzes(root)` out of the inlined string, exactly
// as the WebView would define it. `new Function` runs in module (strict) scope,
// so we return the declared function rather than relying on eval leakage.
const wireQuizzes = new Function(
  `${QUIZ_REVEAL_JS}\nreturn wireQuizzes;`,
) as () => (root: HTMLElement) => void;
const wire = wireQuizzes();

const quiz = (): QuizSet => ({
  set_number: 1,
  questions: [{
    question_id: "q1", question_text: "Pick B", question_type: "multiple_choice",
    options: [
      { option_id: "A", text: "Wrong" },
      { option_id: "B", text: "Right" },
      { option_id: "C", text: "Nope" },
    ],
    correct_option: "B", explanation: "Because B.", difficulty: "easy",
  }],
  total_questions: 1, passing_score: null, estimated_duration_minutes: null,
});

function mount(): HTMLElement {
  const node = document.createElement("div");
  node.className = "mentible-reader";
  // Render through the production sanitized path so the test DOM carries the
  // exact .quiz-q/.quiz-opt/data-oid/data-correct/.quiz-reveal contract the
  // WebView receives — a renderer change that broke the contract fails here too.
  node.innerHTML = renderChapterQuizToSafeHtml(quiz());
  document.body.appendChild(node);
  wire(node);
  return node;
}

const opt = (node: HTMLElement, oid: string) =>
  node.querySelector<HTMLElement>(`.quiz-opt[data-oid="${oid}"]`)!;
const q = (node: HTMLElement) => node.querySelector<HTMLElement>(".quiz-q")!;
const reveal = (node: HTMLElement) => node.querySelector<HTMLElement>(".quiz-reveal")!;

beforeEach(() => { document.body.innerHTML = ""; });

describe("QUIZ_REVEAL_JS (native inlined wireQuizzes)", () => {
  it("starts unanswered: reveal hidden, no state classes (non-vacuity anchor)", () => {
    const node = mount();
    expect(reveal(node).hasAttribute("hidden")).toBe(true);
    expect(q(node).getAttribute("data-answered")).toBe("");
    expect(node.querySelector(".picked")).toBeNull();
  });

  it("grades a wrong pick, highlights the true correct, locks, and reveals", () => {
    const node = mount();
    opt(node, "A").click();
    expect(q(node).getAttribute("data-answered")).toBe("A");
    expect(opt(node, "A").classList.contains("picked")).toBe(true);
    expect(opt(node, "A").classList.contains("incorrect")).toBe(true);
    expect(opt(node, "B").classList.contains("correct")).toBe(true);
    expect(reveal(node).hasAttribute("hidden")).toBe(false);
    for (const b of Array.from(node.querySelectorAll<HTMLElement>(".quiz-opt"))) {
      expect(b.hasAttribute("disabled")).toBe(true);
    }
  });

  it("grades a correct pick with no .incorrect anywhere", () => {
    const node = mount();
    opt(node, "B").click();
    expect(opt(node, "B").classList.contains("picked")).toBe(true);
    expect(opt(node, "B").classList.contains("correct")).toBe(true);
    expect(node.querySelector(".quiz-opt.incorrect")).toBeNull();
    expect(reveal(node).hasAttribute("hidden")).toBe(false);
  });

  it("locks after the first pick: a later pick does not change the grade", () => {
    const node = mount();
    opt(node, "A").click(); // wrong → locks
    opt(node, "B").click(); // must be ignored
    expect(q(node).getAttribute("data-answered")).toBe("A");
    expect(opt(node, "B").classList.contains("picked")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/quizReveal.native.test.ts`
Expected: FAIL — `QUIZ_REVEAL_JS` is not exported from `@/components/contentHtml` (import/type error, or `new Function` throws on `undefined`).

- [ ] **Step 3: Add + export `QUIZ_REVEAL_JS`**

In `mobile/src/components/contentHtml.ts`, add this constant next to the other inlined-JS constants (near `TOPIC_SANITIZE_HOOK_JS`). It must be `export`ed:

```ts
// Interactive quiz reveal, inlined for the native WebView (the sandbox can't
// import bundle modules). A faithful ES5 mirror of `@/reader/quizReveal`'s
// `wireQuizzes`: it runs AFTER DOMPurify, over the already-sanitized quiz DOM the
// renderer emitted, attaching app-owned click handlers and injecting no markup.
// Kept in lockstep with the TS original by parity behavioral tests
// (quizReveal.native.test.ts here + quizReveal.test.ts on web) over the shared
// .quiz-q/.quiz-opt/data-* contract from `renderQuizzes`. Single quotes only, so
// it nests inside the htmlDocument template literal.
export const QUIZ_REVEAL_JS = `
function wireQuizzes(root) {
  if (!root) return;
  var questions = root.querySelectorAll('.quiz-q');
  for (var i = 0; i < questions.length; i++) {
    (function (question) {
      var options = question.querySelector('.quiz-options');
      if (!options) return;
      options.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.quiz-opt') : null;
        if (!btn || !options.contains(btn)) return;
        if (question.getAttribute('data-answered')) return;
        question.setAttribute('data-answered', btn.getAttribute('data-oid') || '');
        btn.classList.add('picked', btn.getAttribute('data-correct') === 'true' ? 'correct' : 'incorrect');
        var truth = question.querySelector('.quiz-opt[data-correct="true"]');
        if (truth) truth.classList.add('correct');
        var all = question.querySelectorAll('.quiz-opt');
        for (var j = 0; j < all.length; j++) {
          all[j].setAttribute('disabled', '');
          all[j].removeAttribute('tabindex');
        }
        var rev = question.querySelector('.quiz-reveal');
        if (rev) rev.removeAttribute('hidden');
      });
    })(questions[i]);
  }
}
`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest __tests__/components/quizReveal.native.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/contentHtml.ts mobile/__tests__/components/quizReveal.native.test.ts
git commit -m "feat(open-shelves): inline native quiz-reveal (QUIZ_REVEAL_JS) + behavioral test"
```

---

### Task 2: Wire `wireQuizzes` into the native `htmlDocument`

**Files:**
- Modify: `mobile/src/components/contentHtml.ts` (`htmlDocument`)
- Test: `mobile/__tests__/components/contentHtml.test.ts` (extend)

**Interfaces:**
- Consumes: `QUIZ_REVEAL_JS` (Task 1), the existing `htmlDocument` IIFE and its `<script>` block layout.
- Produces: `buildTopicHtml(...)` and `buildChapterQuizHtml(...)` output now contains the `wireQuizzes` definition and a call to it.

- [ ] **Step 1: Write the failing test**

Add to `mobile/__tests__/components/contentHtml.test.ts` (it already imports `buildTopicHtml` and defines a `topic(extra?)` factory used by the other cases — reuse both; add `buildChapterQuizHtml` to the `@/components/contentHtml` import, and `import type { QuizSet } from "@/types/book";`). Append this block:

```ts
describe("native quiz-reveal wiring", () => {
  const quizSet: QuizSet = {
    set_number: 1,
    questions: [{
      question_id: "q1", question_text: "Pick B", question_type: "multiple_choice",
      options: [{ option_id: "A", text: "Wrong" }, { option_id: "B", text: "Right" }],
      correct_option: "B", explanation: "Because B.", difficulty: "easy",
    }],
    total_questions: 1, passing_score: null, estimated_duration_minutes: null,
  };

  it("defines wireQuizzes and calls it in the topic document", () => {
    const doc = buildTopicHtml(topic());
    expect(doc).toContain("function wireQuizzes(root)");
    expect(doc).toContain("wireQuizzes(document.getElementById('root'))");
  });

  it("wires the chapter-quiz document too (F2 routes through htmlDocument)", () => {
    const doc = buildChapterQuizHtml(quizSet);
    expect(doc).toContain("function wireQuizzes(root)");
    expect(doc).toContain("wireQuizzes(document.getElementById('root'))");
  });
});
```

Note: `minimalTopic()` is the existing helper in this test file (used by the other `buildTopicHtml` cases). If the file names it differently, reuse whatever factory the existing `buildTopicHtml` tests already call — do not add a new one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/contentHtml.test.ts -t "native quiz-reveal wiring"`
Expected: FAIL — the document contains neither `function wireQuizzes` nor the call yet.

- [ ] **Step 3: Inject the script and call `wireQuizzes` in `htmlDocument`**

In `mobile/src/components/contentHtml.ts`, in `htmlDocument`:

(a) Add the script tag alongside the existing inlined-JS script tags (right after `<script>${TOPIC_SANITIZE_HOOK_JS}</script>`):

```html
<script>${QUIZ_REVEAL_JS}</script>
```

(b) Inside the IIFE, after the Mermaid `initialize` block and before the IIFE closes (`})();`), add:

```js
  // Interactive quiz reveal — parity with the web reader's enhanceReaderNode →
  // wireQuizzes. Inlined above, so always defined; the guard is only against a
  // runtime DOM edge case, never absence: a malformed quiz must not blank the page.
  try {
    wireQuizzes(document.getElementById('root'));
  } catch (e) { /* quiz stays static; the rest of the page still reads */ }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest __tests__/components/contentHtml.test.ts __tests__/components/quizReveal.native.test.ts __tests__/reader/quizReveal.test.ts`
Expected: PASS (the new wiring cases, the existing native document-structure cases, and the web reveal cases all green — the `var DATA = {...}` embed the existing test parses is unaffected by the added script/call).

- [ ] **Step 5: Full gate + commit**

```bash
cd mobile && npx jest && npx tsc --noEmit && npx eslint .
git add mobile/src/components/contentHtml.ts mobile/__tests__/components/contentHtml.test.ts
git commit -m "feat(open-shelves): wire native WebView quizzes to be interactive (topic + F2 chapter)"
```

---

## Notes for the implementer

- **Help / Definition of Done:** interactive quizzes are an already-shipped, Help-documented feature (F2); this closes a platform gap, not a new feature key, so no new Help topic is required. Before finishing, grep `mobile/src/help-content/` for any copy that claims quiz interactivity is web-only and correct it if found (do not invent new claims).
- **Do not** add score/retry/reset — that is explicitly out of scope (spec Non-goals).
- **Do not** touch `htmlChapterDocument` or the web `wireQuizzes`/`enhance.ts`.
