// Locks the PDF print format that was tuned against the Sri Rudram Namakam
// export: diagram sizing (#623) and the empty-block / page-break rules
// (#621, #622). If one of these changes, the printed book changes; update
// this test deliberately, not by accident.
import { buildPdfHtml } from "../src/pdf";
import type { Book } from "../src/types";

const book = {
  id: "b", title: "Lock", createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:00.000Z",
  toc: { subjects: [{ subject_label: "S", units: [{ id: "c1", title: "Anuvaka 1 — T", subtopics: [], prerequisites: [] }] }] },
  content: { c1: { topicId: "c1", title: "Anuvaka 1 — T", generatedAt: "2026-11-18T00:00:00.000Z",
    lesson: { topic: "t", level: "intro", language: "en", synopsis: "s", learning_objectives: ["o"],
      sections: [{ heading: "H", body_markdown: "text" }], key_takeaways: ["k"], further_reading: [] } } },
} as unknown as Book;

describe("PDF format lock", () => {
  const html = buildPdfHtml(book);

  it("sizes diagrams to full text width, capped at 150mm tall (#623)", () => {
    expect(html).toMatch(/\.diagram svg \{[^}]*max-height: 150mm;[^}]*width: 100%;/);
    expect(html).toMatch(/\.diagram svg, \.diagram img \{[^}]*max-height: 150mm;[^}]*width: 100%;/);
  });

  it("keeps the chapter page break and diagram no-split rules", () => {
    expect(html).toMatch(/\.chapter, \.quizzes, \.answers \{ break-before: page; \}/);
    expect(html).toMatch(/\.diagram \{[^}]*break-inside: avoid;/);
  });

  it("hides empty blocks and a chapter's final rule (#621)", () => {
    expect(html).toMatch(/:where\(div, p, section, ul, ol, dl, blockquote, aside\):empty/);
    expect(html).toMatch(/\.chapter > hr:last-child/);
  });

  it("keeps bold labels with their following text (#622)", () => {
    expect(html).toMatch(/p:has\(> strong:only-child\) \{ break-after: avoid; \}/);
  });
});
