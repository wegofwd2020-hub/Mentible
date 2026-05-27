import {
  renderLesson,
  renderTutorial,
  renderQuizzes,
  renderExperiment,
  renderTopicBody,
} from "../src/renderCore";
import { renderMarkdown } from "../src/markdown";
import { PassthroughDiagramRenderer, type DiagramRenderer } from "../src/diagrams";
import { escapeHtml } from "../src/html";
import type {
  ExperimentOutput,
  GeneratedTopic,
  LessonOutput,
  QuizSet,
  TutorialOutput,
} from "../src/types";

const diagrams = new PassthroughDiagramRenderer();

const LESSON: LessonOutput = {
  topic: "Kinematics",
  level: "intro",
  language: "en",
  synopsis: "Motion in a straight line.",
  learning_objectives: ["Define velocity", "Use $v = d/t$"],
  sections: [{ heading: "Velocity", body_markdown: "Average velocity is $v=\\frac{\\Delta x}{\\Delta t}$." }],
  key_takeaways: ["Velocity is a vector"],
  further_reading: ["A textbook"],
};

describe("renderMarkdown", () => {
  it("renders inline maths to MathML, not to a CDN-dependent span", () => {
    const html = renderMarkdown("Speed is $v = d/t$ here.", diagrams);
    expect(html).toContain("<math");
    expect(html).not.toContain("cdn");
    expect(html).not.toContain("katex.min"); // no stylesheet/script reference
  });

  it("delegates ```mermaid blocks to the DiagramRenderer", () => {
    const spy: DiagramRenderer = { render: jest.fn(() => "<!--DIAGRAM-->") };
    const html = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```", spy);
    expect(spy.render).toHaveBeenCalledWith("graph TD; A-->B;");
    expect(html).toContain("<!--DIAGRAM-->");
  });

  it("renders a normal code block as <pre><code>, escaped", () => {
    const html = renderMarkdown("```js\nconst x = 1 < 2;\n```", diagrams);
    expect(html).toContain("<pre><code>");
    expect(html).toContain("1 &lt; 2");
  });

  it("renders GFM tables with an (auto-numbered) caption element", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |", diagrams);
    expect(html).toContain("<table");
    expect(html).toContain("<caption></caption>"); // CSS adds "Table N."
    expect(html).toContain("<td>1</td>");
  });
});

describe("renderLesson", () => {
  const html = renderLesson(LESSON, diagrams);
  it("includes title, synopsis, objectives, and takeaways", () => {
    expect(html).toContain("<h1>Kinematics</h1>");
    expect(html).toContain('class="synopsis"');
    expect(html).toContain("Learning objectives");
    expect(html).toContain("Key takeaways");
  });
  it("renders section-body maths as MathML", () => {
    expect(html).toContain("<math");
  });
});

describe("renderQuizzes", () => {
  const sets: QuizSet[] = [
    {
      set_number: 1,
      total_questions: 1,
      passing_score: null,
      estimated_duration_minutes: null,
      questions: [
        {
          question_id: "q1",
          question_text: "What is $v$ if $d=10$, $t=2$?",
          question_type: "multiple_choice",
          options: [
            { option_id: "A", text: "5" },
            { option_id: "B", text: "20" },
          ],
          correct_option: "A",
          explanation: "$10/2 = 5$.",
          difficulty: "easy",
        },
      ],
    },
  ];
  const html = renderQuizzes(sets, diagrams);
  it("marks the correct option and shows the answer key (static)", () => {
    expect(html).toMatch(/<li class="correct"><b>A\.<\/b> 5 ✓<\/li>/);
    expect(html).toContain('class="quiz-answer"');
    expect(html).toContain("<b>Answer:</b> A");
  });
  it("renders maths inside question and explanation", () => {
    expect((html.match(/<math/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderTutorial & renderExperiment", () => {
  it("renders tutorial sections, examples, and common mistakes", () => {
    const tut: TutorialOutput = {
      title: "Working with velocity",
      sections: [
        { section_id: "s1", title: "Setup", content: "Start here.", examples: ["`x = 1`"], practice_question: "Try it" },
      ],
      common_mistakes: ["Confusing speed and velocity"],
    };
    const html = renderTutorial(tut, diagrams);
    expect(html).toContain("Working with velocity");
    expect(html).toContain("Examples");
    expect(html).toContain('class="practice"');
    expect(html).toContain("Common mistakes");
  });

  it("renders experiment materials, steps, and questions", () => {
    const exp: ExperimentOutput = {
      experiment_title: "Measure g",
      materials: ["A ball", "A timer"],
      safety_notes: ["Mind your toes"],
      steps: [{ step_number: 1, instruction: "Drop the ball", expected_observation: "It falls" }],
      questions: [{ question: "Why?", answer: "Gravity" }],
      conclusion_prompt: "Summarise",
    };
    const html = renderExperiment(exp);
    expect(html).toContain("Measure g");
    expect(html).toContain("Materials");
    expect(html).toContain('class="step"');
    expect(html).toContain("Gravity");
  });
});

describe("renderTopicBody", () => {
  it("includes only the parts the topic carries", () => {
    const lessonOnly: GeneratedTopic = {
      topicId: "t1",
      title: "Kinematics",
      lesson: LESSON,
      generatedAt: "2026-05-27T00:00:00.000Z",
    };
    const html = renderTopicBody(lessonOnly, diagrams);
    expect(html).toContain("<h1>Kinematics</h1>");
    expect(html).not.toContain("<h2>Quiz</h2>");
    expect(html).not.toContain(">Tutorial<");
  });
});

describe("escapeHtml", () => {
  it("escapes the dangerous characters", () => {
    expect(escapeHtml('a < b & "c"')).toBe("a &lt; b &amp; &quot;c&quot;");
    expect(escapeHtml(null)).toBe("");
  });
});
