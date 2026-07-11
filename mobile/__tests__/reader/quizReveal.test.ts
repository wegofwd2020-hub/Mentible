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
