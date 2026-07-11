# Interactive Quiz Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the native web reader an interactive quiz: the learner taps an option to commit an answer, then the question locks and reveals right/wrong + the explanation.

**Architecture:** Approach A (post-mount interaction pass). `renderContent.ts` emits quiz options as `<button>`s carrying `data-oid`/`data-correct` with the answer/explanation in a `hidden` reveal block. A new web-only `quizReveal.ts` module attaches app-owned click handlers over the already-sanitized DOM (the same post-mount pattern as the KaTeX/Mermaid passes in `enhance.ts`). All state lives in the DOM (`data-answered` per question); a remount resets it. No sanitize-config change.

**Tech Stack:** TypeScript, React Native Web, jest + jsdom, DOMPurify (unchanged).

**Spec:** `docs/superpowers/specs/2026-07-11-interactive-quiz-reveal-design.md`

## Global Constraints

- **Web-only.** Touch only `mobile/src/reader/*` (the `.web` reader graph). No changes to the RN reader stub, `src/components/contentHtml.ts` (iframe), the WebView path, or routing.
- **The single DOMPurify pass in `renderTopicToSafeHtml` is the security boundary.** `quizReveal.ts` may only read/toggle attributes and classes on already-sanitized nodes; it must never inject HTML.
- **No sanitize-config change.** `<button>`, `class`, `data-oid`, `data-correct`, `role`, `tabindex`, `aria-*`, `hidden` are already verified to survive `sanitizeFragment`.
- **jsdom test env:** every reader test file starts with `/** @jest-environment jsdom */`. Mock factories that close over a variable must name it `mock*` (babel-plugin-jest-hoist rule in this repo).
- **Run tests from `mobile/`:** `cd mobile && npx jest <path>`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Quiz markup contract (`renderContent.ts`)

**Files:**
- Modify: `mobile/src/reader/renderContent.ts` (`renderQuizzes`, lines 58-81)
- Test: `mobile/__tests__/reader/renderContent.test.ts` (the `describe("quiz", …)` block, lines 204-227)

**Interfaces:**
- Produces (consumed by Tasks 2 & 4): each quiz question renders as
  `<div class="quiz-q" data-answered="">` containing a `<ul class="quiz-options" role="group">` of `<li><button type="button" class="quiz-opt" data-oid="<id>" data-correct="<true|false>">…</button></li>`, followed by `<div class="quiz-reveal" hidden>` wrapping `.quiz-answer` / `.quiz-expl` / `.difficulty`.

- [ ] **Step 1: Update the failing tests** to the new contract. In `mobile/__tests__/reader/renderContent.test.ts`, replace the two tests at lines 205-221 (`"renders questions, options, and marks the correct one"` and `"shows the answer and explanation statically"`) with:

```ts
  it("renders each option as a button carrying its id and correctness", () => {
    const html = renderTopicToSafeHtml(topic({ quizSets: [quizSet()] }));
    expect(html).toContain("<h2>Quiz</h2>");
    expect(html).toContain("What is $x$?");
    expect(html).toMatch(/<button[^>]+class="quiz-opt"[^>]+data-oid="A"[^>]+data-correct="false"/);
    expect(html).toMatch(/<button[^>]+data-oid="B"[^>]+data-correct="true"/);
    expect(html).toContain("Wrong");
    // No answer marker leaks into the option list at render time.
    expect(html).not.toContain('class="correct"');
    expect(html).not.toContain(" ✓");
  });

  // The answer/explanation are present in the DOM but inside a `hidden` block, so they
  // stay out of find-in-page/selection until quizReveal (Task 2) unhides them.
  it("keeps the answer and explanation inside a hidden reveal block", () => {
    const html = renderTopicToSafeHtml(topic({ quizSets: [quizSet()] }));
    expect(html).toContain('data-answered=""');
    expect(html).toMatch(/<div class="quiz-reveal" hidden/);
    expect(html).toContain('<div class="quiz-answer">');
    expect(html).toContain("<strong>B</strong>"); // explanation markdown
    expect(html).toContain("easy"); // difficulty
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest __tests__/reader/renderContent.test.ts -t quiz`
Expected: FAIL — the current markup has `class="correct"` and ` ✓`, and no `.quiz-opt`/`.quiz-reveal`.

- [ ] **Step 3: Rewrite `renderQuizzes`** in `mobile/src/reader/renderContent.ts` (replace the whole function body at lines 58-81) with:

```ts
// Interactive reveal (spec 2026-07-11): options are buttons carrying their id and
// correctness; the answer/explanation live in a `hidden` block that quizReveal.ts
// (enhance pass) unhides once the learner picks. `data-answered=""` = unanswered.
function renderQuizzes(sets: QuizSet[]): string {
  let h = `${DIVIDER}<h2>Quiz</h2>`;
  for (const set of sets) {
    if (sets.length > 1 && set.set_number != null) {
      h += `<h3>Set ${escapeHtml(set.set_number)}</h3>`;
    }
    (set.questions ?? []).forEach((q, i) => {
      h += '<div class="quiz-q" data-answered="">';
      h += `<div class="quiz-qtext">${md(`${i + 1}. ${q.question_text || ""}`)}</div>`;
      h += '<ul class="quiz-options" role="group">';
      for (const o of q.options ?? []) {
        const correct = o.option_id === q.correct_option;
        h += `<li><button type="button" class="quiz-opt" data-oid="${escapeHtml(o.option_id)}" data-correct="${correct}">`;
        h += `<b>${escapeHtml(o.option_id)}.</b> ${escapeHtml(o.text)}</button></li>`;
      }
      h += "</ul>";
      h += '<div class="quiz-reveal" hidden>';
      h += `<div class="quiz-answer"><b>Answer:</b> ${escapeHtml(q.correct_option)}</div>`;
      if (q.explanation) h += `<div class="quiz-expl">${md(q.explanation)}</div>`;
      if (q.difficulty) h += `<div class="difficulty">${escapeHtml(q.difficulty)}</div>`;
      h += "</div></div>";
    });
  }
  return h;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest __tests__/reader/renderContent.test.ts`
Expected: PASS (whole file — the `Set 1`/`Set 2` and omit tests are unaffected).

- [ ] **Step 5: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/reader/renderContent.ts mobile/__tests__/reader/renderContent.test.ts
git commit -m "$(printf 'feat(reader): quiz markup contract for interactive reveal\n\nOptions become <button> with data-oid/data-correct; answer + explanation\nmove into a hidden .quiz-reveal block. Static reveal (D6) replaced by the\ncontract quizReveal.ts drives. Web-only, sanitize config unchanged.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `wireQuizzes` interaction pass (`quizReveal.ts`)

**Files:**
- Create: `mobile/src/reader/quizReveal.ts`
- Test: `mobile/__tests__/reader/quizReveal.test.ts`

**Interfaces:**
- Consumes (from Task 1): the `.quiz-q` / `.quiz-opt` / `.quiz-reveal` markup contract.
- Produces (consumed by Task 3): `export function wireQuizzes(node: HTMLElement): void`.

- [ ] **Step 1: Write the failing test.** Create `mobile/__tests__/reader/quizReveal.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import { wireQuizzes } from "@/reader/quizReveal";
import type { GeneratedTopic, QuizSet } from "@/types/book";

const quizSet = (): QuizSet => ({
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

const topic = (quizSets: QuizSet[]): GeneratedTopic => ({
  topicId: "t", title: "T", generatedAt: "2026-07-11T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [], key_takeaways: [], further_reading: [],
  },
  quizSets,
} as unknown as GeneratedTopic);

function mount(): HTMLElement {
  const node = document.createElement("div");
  node.className = "mentible-reader";
  node.innerHTML = renderTopicToSafeHtml(topic([quizSet()]));
  document.body.appendChild(node);
  wireQuizzes(node);
  return node;
}

const opt = (node: HTMLElement, oid: string) =>
  node.querySelector<HTMLElement>(`.quiz-opt[data-oid="${oid}"]`)!;
const q = (node: HTMLElement) => node.querySelector<HTMLElement>(".quiz-q")!;
const reveal = (node: HTMLElement) => node.querySelector<HTMLElement>(".quiz-reveal")!;

beforeEach(() => { document.body.innerHTML = ""; });

describe("wireQuizzes", () => {
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/quizReveal.test.ts`
Expected: FAIL — `Cannot find module '@/reader/quizReveal'`.

- [ ] **Step 3: Write the module.** Create `mobile/src/reader/quizReveal.ts`:

```ts
// Interactive quiz reveal for the native web reader (spec 2026-07-11): the learner
// taps an option to commit; the question then locks and reveals right/wrong + the
// explanation. App-owned handlers over the already-sanitized DOM — nothing new is
// injected, so the DOMPurify boundary is untouched. State lives entirely in the DOM
// (a `data-answered` value per `.quiz-q`), so a remount resets the quiz.
//
// Runs AFTER sanitization, like the KaTeX/Mermaid passes in enhance.ts. Web-only.

/** Wire click-to-answer on every `.quiz-q` under `node`. */
export function wireQuizzes(node: HTMLElement): void {
  for (const question of Array.from(node.querySelectorAll<HTMLElement>(".quiz-q"))) {
    const options = question.querySelector<HTMLElement>(".quiz-options");
    if (!options) continue;

    options.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>(".quiz-opt");
      if (!btn || !options.contains(btn)) return;
      if (question.getAttribute("data-answered")) return; // locked after the first pick

      question.setAttribute("data-answered", btn.getAttribute("data-oid") ?? "");
      btn.classList.add(
        "picked",
        btn.getAttribute("data-correct") === "true" ? "correct" : "incorrect",
      );
      question
        .querySelector<HTMLElement>('.quiz-opt[data-correct="true"]')
        ?.classList.add("correct");

      for (const b of Array.from(question.querySelectorAll<HTMLElement>(".quiz-opt"))) {
        b.setAttribute("disabled", "");
        b.removeAttribute("tabindex");
      }
      question.querySelector<HTMLElement>(".quiz-reveal")?.removeAttribute("hidden");
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/quizReveal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/reader/quizReveal.ts mobile/__tests__/reader/quizReveal.test.ts
git commit -m "$(printf 'feat(reader): wireQuizzes — select-then-grade interactive reveal\n\nApp-owned click handlers over the sanitized quiz DOM: first pick locks the\nquestion, marks right/wrong, highlights the true-correct option, and unhides\nthe explanation. State is DOM-only (data-answered), so a remount resets it.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Wire `wireQuizzes` into the enhance pass (`enhance.ts`)

**Files:**
- Modify: `mobile/src/reader/enhance.ts` (`enhanceReaderNode`, lines 51-58; add an import)
- Test: `mobile/__tests__/reader/enhance.test.ts` (add a mock + one test)

**Interfaces:**
- Consumes (from Task 2): `wireQuizzes(node: HTMLElement): void`.
- Produces: `enhanceReaderNode` invokes `wireQuizzes(node)` once per mount.

- [ ] **Step 1: Write the failing test.** In `mobile/__tests__/reader/enhance.test.ts`, add this mock next to the existing `jest.mock("mermaid", …)` / `jest.mock("katex/contrib/auto-render", …)` blocks (near line 25):

```ts
const mockWireQuizzes = jest.fn();
jest.mock("@/reader/quizReveal", () => ({
  wireQuizzes: (...a: unknown[]) => mockWireQuizzes(...a),
}));
```

Then add this test inside the `describe("enhanceReaderNode", …)` block:

```ts
  it("wires quiz reveal over the mounted node", () => {
    const node = nodeWith('<div class="quiz-q" data-answered=""></div>');
    enhanceReaderNode(node);
    expect(mockWireQuizzes).toHaveBeenCalledWith(node);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/enhance.test.ts -t "wires quiz"`
Expected: FAIL — `mockWireQuizzes` not called (enhance doesn't call it yet).

- [ ] **Step 3: Wire it up.** In `mobile/src/reader/enhance.ts`, add the import after the existing `renderMathInElement` import (line 12):

```ts
import { wireQuizzes } from "@/reader/quizReveal";
```

Then in `enhanceReaderNode` (lines 51-58), add the `wireQuizzes` call so the body reads:

```ts
export function enhanceReaderNode(node: HTMLElement): () => void {
  let cancelled = false;
  renderMath(node);
  wireQuizzes(node);
  void renderDiagrams(node, () => cancelled);
  return () => {
    cancelled = true;
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest __tests__/reader/enhance.test.ts`
Expected: PASS (the whole file — the new test plus the existing KaTeX/Mermaid tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/reader/enhance.ts mobile/__tests__/reader/enhance.test.ts
git commit -m "$(printf 'feat(reader): run wireQuizzes in the enhance post-mount pass\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Quiz-option styling (`readerStyles.ts`)

**Files:**
- Modify: `mobile/src/reader/readerStyles.ts` (add `--error` var at line 25; replace the quiz rules at lines 104-106)
- Test: (no new test) `mobile/__tests__/reader/NativeTopicReader.test.tsx`'s existing "emits a scoped stylesheet" test enforces the every-rule-scoped invariant.

**Interfaces:**
- Consumes (from Task 1): the `.quiz-opt`, `.quiz-opt.correct`, `.quiz-opt.incorrect` class contract.
- Produces: scoped styles; no code interface.

CSS is not behavior, so this task verifies via the existing scoping test + typecheck rather than a new failing test.

- [ ] **Step 1: Add the `--error` CSS variable.** In `mobile/src/reader/readerStyles.ts`, after line 25 (`--success: ${colors.success};`) add:

```ts
  --error: ${colors.error};
```

- [ ] **Step 2: Replace the quiz-option rules.** Replace lines 104-106 (the `.quiz-options`, `.quiz-options li`, and `.quiz-options li.correct` rules) with:

```ts
.${READER_ROOT_CLASS} .quiz-options { list-style: none; padding-left: 0; margin: 8px 0; }
.${READER_ROOT_CLASS} .quiz-options li { padding: 2px 0; }
.${READER_ROOT_CLASS} .quiz-opt {
  display: block; width: 100%; text-align: left; padding: 6px 8px; margin: 0;
  font: inherit; color: var(--text2); background: transparent;
  border: 1px solid var(--border); border-radius: 6px; cursor: pointer;
}
.${READER_ROOT_CLASS} .quiz-opt:hover:not([disabled]) { background: var(--surface); }
.${READER_ROOT_CLASS} .quiz-opt[disabled] { cursor: default; }
.${READER_ROOT_CLASS} .quiz-opt.correct { color: var(--success); font-weight: 600; }
.${READER_ROOT_CLASS} .quiz-opt.correct::after { content: " ✓"; }
.${READER_ROOT_CLASS} .quiz-opt.incorrect { color: var(--error); }
.${READER_ROOT_CLASS} .quiz-opt.incorrect::after { content: " ✗"; }
```

(The existing `.quiz-answer`, `.quiz-expl`, and `.difficulty` rules at lines 107-109 stay unchanged.)

- [ ] **Step 3: Verify the scoping invariant + types hold**

Run: `cd mobile && npx jest __tests__/reader/NativeTopicReader.test.tsx -t "scoped stylesheet" && npm run typecheck`
Expected: PASS — every new selector still begins with `.mentible-reader`, rule count stays > 40; `tsc` clean (`--error` references `colors.error`, which exists).

- [ ] **Step 4: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/reader/readerStyles.ts
git commit -m "$(printf 'feat(reader): quiz-option button styling + correct/incorrect states\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Full-suite regression gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck, lint, full jest**

Run:
```bash
cd mobile && npm run typecheck && npm run lint && npm test
```
Expected: `tsc` 0 errors; lint 0 errors; jest all suites pass (was 86 suites / 515 tests + the new `quizReveal.test.ts` suite and the added enhance/renderContent cases). Confirm `__tests__/reader/NativeTopicReader.test.tsx`'s DOMParser security test still passes over the new button/`data-*` markup.

- [ ] **Step 2: (optional) Drive it in a real browser.** If verifying visually, build and open the web export with the flag on:

```bash
cd mobile && EXPO_PUBLIC_NATIVE_READER=1 npx expo export --platform web --clear
```
Open a topic containing a quiz; tap a wrong option → it turns red with ✗, the correct option turns green with ✓, options lock, explanation appears; reload → quiz resets.

---

## Notes for the implementer

- **Do not** touch `src/components/contentHtml.ts` (the iframe reader). It intentionally stays static (spec §7). The native reader now exceeds it; that is allowed.
- **Do not** widen the DOMPurify config. Everything needed already survives it (verified).
- The `data-answered` guard assumes `option_id` is always non-empty (always "A"–"D" in practice); an empty id would not lock, but the `disabled` attribute set on every option is a second lock, so the question still cannot be re-answered.
- Help content (`FEATURES` key + Help topic) is **out of scope** here — it lands in the D1 flag-flip PR (spec §7), so the help coverage gate is not tripped by this work.
