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

  it("includes a colophon page (after the cover, before the TOC) from metadata", () => {
    const b = book();
    b.metadata = { author: "Jane Doe", publisher: "Mentible", date: "2026", language: "en" };
    const html = buildPdfHtml(b);
    expect(html).toContain('class="colophon"');
    expect(html).toContain("by Jane Doe");
    expect(html).toContain("Mentible");
    expect(html).toContain("All rights reserved."); // synthesised from author + year
    // order in the body: cover-page section → colophon section → toc
    expect(html.indexOf('class="cover-page"')).toBeLessThan(html.indexOf('class="colophon"'));
    expect(html.indexOf('class="colophon"')).toBeLessThan(html.indexOf('id="toc"'));
    expect(html).toContain('<html lang="en">');
  });
});

describe("buildPdfHtml — typography & numbering CSS", () => {
  const html = buildPdfHtml(book());
  it("uses Playfair headings (Studio P4, matching the EPUB) and per-chapter float numbering + list styles", () => {
    const headingRule = html.match(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*\}/);
    expect(headingRule).not.toBeNull();
    expect(headingRule![0]).toMatch(/font-family:\s*'Playfair Display'/);
    expect(headingRule![0]).toContain("font-weight: 500");
    expect(headingRule![0]).toContain("font-synthesis: none");
    expect(headingRule![0]).not.toContain("Nimbus Sans"); // old sans-serif headings gone (Nimbus Sans stays elsewhere, e.g. th)
    expect(html).toContain(".toc-part"); // Part labels in the grouped TOC
    expect(html).toContain("nav.floatlist"); // List of Figures / List of Tables
    expect(html).toContain(".fnum"); // figure/table number styling
    // page references (TOC + float lists) resolved by the paged-media engine
    expect(html).toContain("target-counter(attr(href url), page)");
  });

  it("carries the Studio palette, not the old indigo brand", () => {
    expect(html).toContain("#8A6A22"); // STUDIO.gold — th/fnum/toc-part/objectives accent
    expect(html).toContain("#0A0E1A"); // STUDIO.navy — takeaways panel + cover-page wrapper
    expect(html).not.toContain("#312a8c"); // old BRAND.indigo
    expect(html).not.toContain("#1e1b4b"); // old BRAND.indigoDark
    expect(html).not.toContain("#16a34a"); // old (non-token) green
    expect(html).not.toContain("#4ade80"); // old (non-token) bright green
  });

  it("uses warm table neutrals + a gold figure caption, matching the EPUB stylesheet (css.ts)", () => {
    expect(html).toContain("#f4f1ea"); // warm even-row background (matches css.ts tbody tr:nth-child(even))
    expect(html).toContain("#e6e0d4"); // warm td border (matches css.ts td)
    expect(html).not.toContain("#f6f5fc"); // old cool-blue even-row background (indigo era)
    expect(html).not.toContain("#d9d9e3"); // old cool-blue td border (indigo era)

    const figcaptionRule = html.match(/\.diagram figcaption\s*\{[^}]*\}/);
    expect(figcaptionRule).not.toBeNull();
    expect(figcaptionRule![0]).toContain("#8A6A22"); // STUDIO.gold, matching css.ts .diagram figcaption
    expect(figcaptionRule![0]).not.toContain("#555"); // old neutral gray caption color
  });
});
