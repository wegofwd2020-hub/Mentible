import { buildPdfHtml, orderedChapters } from "../src/pdf";
import { EmptyBookError } from "../src/epub";
import type { Book, GeneratedTopic, LessonOutput, QuizSet } from "../src/types";

const lesson = (topic: string): LessonOutput => ({
  topic,
  level: "intro",
  language: "en",
  synopsis: `About ${topic}.`,
  learning_objectives: ["obj"],
  sections: [{ heading: "S", body_markdown: `Body of ${topic} with $x=1$.` }],
  key_takeaways: ["k"],
  further_reading: [],
});

const quiz: QuizSet = {
  set_number: 1,
  total_questions: 1,
  passing_score: null,
  estimated_duration_minutes: null,
  questions: [
    {
      question_id: "q1",
      question_text: "What is 2+2?",
      question_type: "multiple_choice",
      options: [
        { option_id: "A", text: "4" },
        { option_id: "B", text: "5" },
      ],
      correct_option: "A",
      explanation: "Because arithmetic.",
      difficulty: "easy",
    },
  ],
};

function book(): Book {
  const topicA: GeneratedTopic = {
    topicId: "u1",
    title: "Alpha",
    lesson: lesson("Alpha"),
    quizSets: [quiz],
    generatedAt: "2026-05-27T00:00:00.000Z",
  };
  const topicB: GeneratedTopic = {
    topicId: "u2",
    title: "Beta",
    lesson: lesson("Beta"),
    generatedAt: "2026-05-27T00:00:00.000Z",
  };
  return {
    id: "b1",
    title: "Print Me",
    toc: {
      subjects: [
        {
          subject_label: "S",
          units: [
            { id: "u1", title: "Alpha", subtopics: [], prerequisites: [] },
            { id: "u2", title: "Beta", subtopics: [], prerequisites: [] },
          ],
        },
      ],
    },
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    content: { u1: topicA, u2: topicB },
  };
}

describe("orderedChapters", () => {
  it("numbers content-bearing topics in reading order", () => {
    const chs = orderedChapters(book());
    expect(chs.map((c) => [c.number, c.id, c.title])).toEqual([
      [1, "ch-001", "Alpha"],
      [2, "ch-002", "Beta"],
    ]);
  });
});

describe("buildPdfHtml — textbook layout", () => {
  const html = buildPdfHtml(book());

  it("has a page-numbered TOC (target-counter) linking chapters + sections", () => {
    expect(html).toContain('content: leader(\'.\') target-counter(attr(href url), page)');
    expect(html).toContain('<a href="#ch-001">Alpha</a>');
    expect(html).toContain('<a href="#ch-002">Beta</a>');
    expect(html).toContain('<a href="#quizzes">Quizzes</a>');
    expect(html).toContain('<a href="#answers">Answers</a>');
  });

  it("renders chapters with lesson content (math as MathML)", () => {
    expect(html).toContain('<section class="chapter" id="ch-001">');
    expect(html).toContain("<math"); // KaTeX MathML
  });

  it("puts quiz QUESTIONS (no answers) in the Quizzes section", () => {
    const quizzes = html.slice(html.indexOf('id="quizzes"'), html.indexOf('id="answers"'));
    expect(quizzes).toContain("What is 2+2?");
    expect(quizzes).toContain("Chapter 1 — Alpha");
    expect(quizzes).not.toContain("Because arithmetic."); // explanation belongs to Answers
  });

  it("puts answers + explanations in the Answers section", () => {
    const answers = html.slice(html.indexOf('id="answers"'));
    expect(answers).toContain("Because arithmetic.");
    expect(answers).toMatch(/answer-key[^>]*><b>1\.<\/b> A/);
  });

  it("throws on a book with no generated content", () => {
    const empty = book();
    empty.content = {};
    expect(() => buildPdfHtml(empty)).toThrow(EmptyBookError);
  });
});
