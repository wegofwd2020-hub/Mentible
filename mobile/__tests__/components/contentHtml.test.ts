import { buildTopicHtml } from "@/components/contentHtml";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";

/** The finished HTML the WebView injects — the body is now rendered in RN (#325). */
function embeddedHtml(doc: string): string {
  const m = doc.match(/var DATA = (\{.*?\});\n/s);
  if (!m) throw new Error("no DATA embed found");
  return (JSON.parse(m[1]) as { __html: string }).__html;
}

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

describe("buildTopicHtml (multi-format topic)", () => {
  // Was: asserted the in-page dispatch SOURCE ("renderLesson(DATA.lesson)",
  // "if (DATA.tutorial)"). That JS is gone — the body is rendered in RN by the
  // shared renderer now (#325). Assert the OUTPUT instead, which is what those
  // strings were standing in for and is not satisfiable by dead source text.
  it("renders the lesson always, and the extras only when present", () => {
    const bare = embeddedHtml(buildTopicHtml(topic()));
    expect(bare).toContain("<h1>"); // the lesson always renders
    expect(bare).not.toContain("quiz-set");
    expect(bare).not.toContain("experiment");
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
  // Was: asserted the twin's SOURCE ("lang === 'svg'", the strip regex) because
  // "the WebView JS can't run in jest". The twin is gone and the markdown is
  // rendered in RN, so the real output is now directly assertable — a strictly
  // better test than matching the code that was supposed to produce it.
  it("drops a ```svg fenced block inline as an animated figure, script-stripped", () => {
    const html = embeddedHtml(buildTopicHtml(topic({
      lesson: {
        ...topic().lesson,
        sections: [{ heading: "S", body_markdown: "```svg\n<svg><script>evil()</script><rect/></svg>\n```" }],
      },
    })));
    expect(html).toContain('<figure class="anim-svg">'); // inline + animated, not <pre><code>
    expect(html).toContain("<rect/>");
    expect(html).not.toContain("<pre><code>");
    expect(html).not.toContain("evil()"); // native has no DOMPurify — see markdown.ts
  });

  it("keeps the anim-svg styling in the document", () => {
    expect(buildTopicHtml(topic())).toContain(".anim-svg");
  });
});
