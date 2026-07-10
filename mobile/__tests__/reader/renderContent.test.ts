/**
 * @jest-environment jsdom
 */
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import type { GeneratedTopic } from "@/types/book";
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
 * DEVIATION FROM THE BRIEF (documented in task-4-report.md): the brief's on*
 * check was `not.toMatch(/\son\w+\s*=/i)`, a bare substring test. escapeHtml()
 * HTML-escapes `"` to `&quot;`, but sanitizeFragment's single DOMPurify pass
 * necessarily parses the whole fragment into a DOM and re-serializes it — and
 * per the WHATWG HTML fragment-serialization algorithm, only `&`, `<`, `>` are
 * re-escaped in text-node content, not `"`. So an escaped payload like
 * `x onerror="alert(1)"` legitimately round-trips back to a literal `x
 * onerror="alert(1)"` *string* inside inert text (e.g. inside an `<h1>`), which
 * the bare substring regex flags even though no live attribute exists (proven:
 * `mobile/node_modules` jsdom does the same unescape with DOMPurify removed
 * from the pipeline entirely). This is standard browser behaviour, not a
 * sanitizer weakness, and is unrelated to sanitize.ts.
 *
 * The tightened regex below requires the on*= to sit inside an actual
 * unescaped tag (`<tagname ... on\w+=`), which only a live DOM attribute can
 * produce — inert escaped text (`&lt;img ... onerror=`) can never match it
 * because its `<` is an entity, not a literal `<`. Verified this still catches
 * a real unstripped handler (e.g. a bare `<img src=x onerror="alert(1)">`).
 */
function expectNoExecutableArtifacts(html: string) {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<[a-z][^<>]*\son\w+\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
}

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
