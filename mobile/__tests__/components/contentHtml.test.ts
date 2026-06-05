import { buildHtml, buildTopicHtml } from "@/components/contentHtml";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";

// The reader builds its body from embedded JSON via in-page JS (marked/KaTeX/
// Mermaid run in the WebView, which jest can't execute). So these assert the
// document shell + that each content type's data is embedded only when present,
// plus that the right per-type render functions are dispatched.

const lesson: LessonOutput = {
  topic: "Why Context Engineering Emerged",
  level: "Grade 11 reading level",
  language: "en",
  synopsis: "A short overview.",
  learning_objectives: ["Explain X"],
  sections: [{ heading: "Introduction", body_markdown: "Intro **body**." }],
  key_takeaways: ["takeaway one"],
  further_reading: [],
};

function topic(extra: Partial<GeneratedTopic> = {}): GeneratedTopic {
  return {
    topicId: "t1",
    title: "Why Context Engineering Emerged",
    generatedAt: "2026-05-26T00:00:00Z",
    lesson,
    ...extra,
  };
}

describe("buildHtml (single lesson)", () => {
  it("produces a full HTML document with the libs wired", () => {
    const html = buildHtml(lesson);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("marked.min.js");
    expect(html).toContain("katex.min.js");
    expect(html).toContain("mermaid");
    expect(html).toContain("renderLesson(DATA)");
  });

  it("embeds the lesson data", () => {
    const html = buildHtml(lesson);
    expect(html).toContain("Why Context Engineering Emerged");
    expect(html).toContain("Intro **body**.");
  });
});

describe("buildTopicHtml (multi-format topic)", () => {
  it("always dispatches the lesson and conditionally the extras", () => {
    const html = buildTopicHtml(topic());
    expect(html).toContain("renderLesson(DATA.lesson)");
    expect(html).toContain("if (DATA.tutorial)");
    expect(html).toContain("if (DATA.quizSets");
    expect(html).toContain("if (DATA.experiment)");
  });

  it("embeds tutorial / quiz / experiment data only when present", () => {
    const full = buildTopicHtml(
      topic({
        tutorial: {
          title: "Tutorial: CE",
          sections: [
            {
              section_id: "s1",
              title: "Step 1",
              content: "Do it.",
              examples: ["ex a"],
              practice_question: "Why?",
            },
          ],
          common_mistakes: ["forgetting context"],
        },
        quizSets: [
          {
            set_number: 1,
            questions: [
              {
                question_id: "q1",
                question_text: "Which?",
                question_type: "multiple_choice",
                options: [
                  { option_id: "A", text: "alpha" },
                  { option_id: "B", text: "beta" },
                ],
                correct_option: "B",
                explanation: "because beta",
                difficulty: "medium",
              },
            ],
            total_questions: 1,
            passing_score: 1,
            estimated_duration_minutes: 5,
          },
        ],
        experiment: {
          experiment_title: "Observe windows",
          materials: ["a laptop"],
          safety_notes: ["mind cables"],
          steps: [{ step_number: 1, instruction: "Open it.", expected_observation: "opens" }],
          questions: [{ question: "What?", answer: "it opened" }],
          conclusion_prompt: "Summarise.",
        },
      }),
    );
    expect(full).toContain("Tutorial: CE");
    expect(full).toContain("forgetting context");
    expect(full).toContain("Observe windows");
    expect(full).toContain("mind cables");

    // A lesson-only topic embeds none of the extra-type payloads.
    const lessonOnly = buildTopicHtml(topic());
    expect(lessonOnly).not.toContain("Observe windows");
    expect(lessonOnly).not.toContain("forgetting context");
  });
});

describe("animated SVG (free animated-visual path)", () => {
  // The WebView JS can't run in jest, so assert the renderer/CSS are wired —
  // a ```svg fenced block is dropped inline (animated) instead of a code block.
  it("wires the svg fenced-block renderer + figure styling", () => {
    const html = buildHtml(lesson);
    expect(html).toContain("lang === 'svg'"); // the renderer branch
    expect(html).toContain("anim-svg"); // figure class + CSS
    expect(html).toContain("<script[\\s\\S]"); // the <script>-strip regex (not a real tag)
  });
});
