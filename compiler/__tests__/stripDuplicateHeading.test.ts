import { stripDuplicateHeading } from "../src/html";
import { renderLesson } from "../src/renderCore";
import { PassthroughDiagramRenderer } from "../src/diagrams";
import type { LessonOutput } from "../src/types";

describe("stripDuplicateHeading", () => {
  it("strips a leading heading that matches the section heading", () => {
    expect(stripDuplicateHeading("## Velocity\n\nBody text.", "Velocity")).toBe("\nBody text.");
  });

  it("is case/space-insensitive and handles closed ATX", () => {
    expect(stripDuplicateHeading("##  velocity  ##\nBody", "Velocity")).toBe("Body");
  });

  it("leaves the body untouched when the leading heading differs", () => {
    const body = "## Overview\n\nText.";
    expect(stripDuplicateHeading(body, "Velocity")).toBe(body);
  });

  it("leaves a body with no leading heading untouched", () => {
    expect(stripDuplicateHeading("Just prose.", "Velocity")).toBe("Just prose.");
  });
});

describe("renderLesson — duplicate section heading", () => {
  const diagrams = new PassthroughDiagramRenderer();
  it("renders the section heading exactly once even when the body repeats it", () => {
    const lesson: LessonOutput = {
      topic: "T",
      level: "intro",
      language: "en",
      synopsis: "s",
      learning_objectives: ["a"],
      sections: [{ heading: "Velocity", body_markdown: "## Velocity\n\nAverage velocity is constant." }],
      key_takeaways: ["k"],
      further_reading: [],
    };
    const html = renderLesson(lesson, diagrams);
    const count = (html.match(/>Velocity</g) || []).length;
    expect(count).toBe(1);
  });
});
