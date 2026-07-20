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
