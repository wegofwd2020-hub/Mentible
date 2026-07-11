/**
 * @jest-environment jsdom
 */
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import type { GeneratedTopic, QuizSet } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

const lesson = (over: Partial<LessonOutput> = {}): LessonOutput => ({
  topic: "Scoped Retrieval",
  level: "adult",
  language: "en",
  synopsis: "A synopsis.",
  learning_objectives: ["Objective one"],
  sections: [{ heading: "Why It Matters", body_markdown: "Body **text**." }],
  key_takeaways: ["Takeaway one"],
  further_reading: ["A book"],
  ...over,
});

const topic = (over: Partial<GeneratedTopic> = {}): GeneratedTopic => ({
  topicId: "t1",
  title: "Scoped Retrieval",
  lesson: lesson(),
  generatedAt: "2026-07-10T00:00:00Z",
  ...over,
});

/**
 * Every content type must satisfy this. The load-bearing assertion of the suite.
 *
 * Asserts over the PARSED DOM, not the serialized string. HTML text-node
 * serialization never re-escapes `"`, so an inert, escaped payload like
 * `&lt;img src=x onerror="alert(1)"&gt;` round-trips with a literal ` onerror="`
 * substring in it — a string regex flags that as executable when it is plain
 * text. Parsing settles the question: an attribute only exists if an element
 * exists.
 */
function expectNoExecutableArtifacts(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
    }
    for (const name of ["href", "src", "xlink:href"]) {
      const v = el.getAttribute(name);
      if (v != null) expect(/^\s*javascript:/i.test(v)).toBe(false);
    }
  }
  expect(doc.querySelectorAll("script").length).toBe(0);
}

describe("expectNoExecutableArtifacts (helper self-test)", () => {
  it("throws on live executable markup", () => {
    expect(() => expectNoExecutableArtifacts('<img src="x" onerror="alert(1)">')).toThrow();
    expect(() => expectNoExecutableArtifacts('<svg onload="alert(1)"></svg>')).toThrow();
    expect(() => expectNoExecutableArtifacts('<a title="a>b" onclick="steal()">x</a>')).toThrow();
    expect(() => expectNoExecutableArtifacts('<a href="javascript:alert(1)">x</a>')).toThrow();
    expect(() => expectNoExecutableArtifacts('<p></p><script>alert(1)</script>')).toThrow();
  });

  it("does not throw on genuinely inert escaped text", () => {
    expect(() => expectNoExecutableArtifacts('<h1>&lt;img src=x onerror="alert(1)"&gt;</h1>')).not.toThrow();
    expect(() => expectNoExecutableArtifacts('<p>Read about the javascript: URL scheme.</p>')).not.toThrow();
  });
});

describe("lesson", () => {
  it("renders title, synopsis, objectives, sections, takeaways", () => {
    const html = renderTopicToSafeHtml(topic());
    expect(html).toContain("<h1>Scoped Retrieval</h1>");
    expect(html).toContain("A synopsis.");
    expect(html).toContain("Objective one");
    expect(html).toContain("<h2>Why It Matters</h2>");
    expect(html).toContain("<strong>text</strong>");
    expect(html).toContain("Takeaway one");
    expect(html).toContain("A book");
  });

  it("drops a body heading that duplicates the section heading", () => {
    const html = renderTopicToSafeHtml(
      topic({ lesson: lesson({ sections: [{ heading: "Why It Matters", body_markdown: "## Why It Matters\n\nBody." }] }) }),
    );
    expect(html.match(/Why It Matters/g)).toHaveLength(1);
  });

  it("SECURITY: neutralises a payload in every lesson field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        lesson: lesson({
          topic: XSS,
          synopsis: XSS,
          learning_objectives: [XSS],
          sections: [{ heading: XSS, body_markdown: XSS }],
          key_takeaways: [XSS],
          further_reading: [XSS],
        }),
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("tutorial", () => {
  it("renders sections, examples, practice, common mistakes", () => {
    const html = renderTopicToSafeHtml(
      topic({
        tutorial: {
          title: "Hands On",
          sections: [{ section_id: "s1", title: "Step One", content: "Do *this*.", examples: ["`code`"], practice_question: "Try it?" }],
          common_mistakes: ["Skipping steps"],
        },
      }),
    );
    expect(html).toContain("Hands On");
    expect(html).toContain("Step One");
    expect(html).toContain("<em>this</em>");
    expect(html).toContain("Try it?");
    expect(html).toContain("Skipping steps");
  });

  it("SECURITY: neutralises a payload in every tutorial field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        tutorial: {
          title: XSS,
          sections: [{ section_id: "s1", title: XSS, content: XSS, examples: [XSS], practice_question: XSS }],
          common_mistakes: [XSS],
        },
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("experiment", () => {
  it("renders materials, safety, steps, questions, conclusion", () => {
    const html = renderTopicToSafeHtml(
      topic({
        experiment: {
          experiment_title: "Measure It",
          materials: ["A ruler"],
          safety_notes: ["Wear goggles"],
          steps: [{ step_number: 1, instruction: "Measure", expected_observation: "10cm" }],
          questions: [{ question: "Why?", answer: "Because." }],
          conclusion_prompt: "Summarise.",
        },
      }),
    );
    expect(html).toContain("Measure It");
    expect(html).toContain("A ruler");
    expect(html).toContain("Wear goggles");
    expect(html).toContain("10cm");
    expect(html).toContain("Because.");
    expect(html).toContain("Summarise.");
  });

  it("SECURITY: neutralises a payload in every experiment field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        experiment: {
          experiment_title: XSS,
          materials: [XSS],
          safety_notes: [XSS],
          steps: [{ step_number: 1, instruction: XSS, expected_observation: XSS }],
          questions: [{ question: XSS, answer: XSS }],
          conclusion_prompt: XSS,
        },
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("optional sections", () => {
  it("omits tutorial/quiz/experiment when absent", () => {
    const html = renderTopicToSafeHtml(topic());
    expect(html).not.toContain("Tutorial");
    expect(html).not.toContain("Experiment");
  });
});

const quizSet = (over: Partial<QuizSet> = {}): QuizSet => ({
  set_number: 1,
  questions: [{
    question_id: "q1",
    question_text: "What is $x$?",
    question_type: "multiple_choice",
    options: [
      { option_id: "A", text: "Wrong" },
      { option_id: "B", text: "Right" },
    ],
    correct_option: "B",
    explanation: "Because **B**.",
    difficulty: "easy",
  }],
  total_questions: 1,
  passing_score: null,
  estimated_duration_minutes: null,
  ...over,
});

describe("quiz", () => {
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

  it("labels each set when there is more than one", () => {
    const html = renderTopicToSafeHtml(topic({ quizSets: [quizSet(), quizSet({ set_number: 2 })] }));
    expect(html).toContain("Set 1");
    expect(html).toContain("Set 2");
  });

  it("omits the set label for a single set", () => {
    expect(renderTopicToSafeHtml(topic({ quizSets: [quizSet()] }))).not.toContain("Set 1");
  });

  it("omits the quiz block for an empty quizSets array", () => {
    expect(renderTopicToSafeHtml(topic({ quizSets: [] }))).not.toContain("<h2>Quiz</h2>");
  });

  it("SECURITY: neutralises a payload in every quiz field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        quizSets: [quizSet({
          questions: [{
            question_id: "q1",
            question_text: XSS,
            question_type: "multiple_choice",
            options: [{ option_id: XSS, text: XSS }],
            correct_option: XSS,
            explanation: XSS,
            difficulty: XSS,
          }],
        })],
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("embedded fences", () => {
  it("keeps a mermaid div and an animated svg figure", () => {
    const html = renderTopicToSafeHtml(
      topic({
        lesson: lesson({
          sections: [{
            heading: "Diagrams",
            body_markdown:
              '```mermaid\ngraph TD;\nA-->B\n```\n\n```svg\n<svg><circle r="2"><animate attributeName="cx" values="0;10" dur="2s"/></circle></svg>\n```',
          }],
        }),
      }),
    );
    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('<figure class="anim-svg">');
    // Spec D7: the animation survives sanitization.
    expect(html).toMatch(/<animate[\s/>]/);
  });

  it("SECURITY: strips script/handlers from a hostile svg fence", () => {
    const html = renderTopicToSafeHtml(
      topic({
        lesson: lesson({
          sections: [{ heading: "D", body_markdown: '```svg\n<svg onload="alert(1)"><script>alert(2)</script></svg>\n```' }],
        }),
      }),
    );
    expectNoExecutableArtifacts(html);
    expect(html).toContain("<svg");
  });
});
