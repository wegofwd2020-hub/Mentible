import { compilePdf, type PdfRenderer } from "../src/pdfRender";
import type { MermaidRenderer } from "../src/mermaid";
import type { Book, LessonOutput } from "../src/types";

const LESSON: LessonOutput = {
  topic: "Diagrams",
  level: "intro",
  language: "en",
  synopsis: "s",
  learning_objectives: ["o"],
  sections: [{ heading: "H", body_markdown: "```mermaid\ngraph TD; A-->B;\n```" }],
  key_takeaways: ["k"],
  further_reading: [],
};

function book(): Book {
  return {
    id: "b1",
    title: "PDF Book",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    content: { u1: { topicId: "u1", title: "T", lesson: LESSON, generatedAt: "2026-05-27T00:00:00.000Z" } },
  };
}

// Capture the HTML handed to the engine; return sentinel PDF bytes.
class FakePdf implements PdfRenderer {
  html = "";
  async renderToPdf(html: string): Promise<Uint8Array> {
    this.html = html;
    return new TextEncoder().encode("%PDF-1.7 fake");
  }
}

it("builds the textbook HTML and hands it to the PDF engine", async () => {
  const fake = new FakePdf();
  const bytes = await compilePdf(book(), { pdf: fake });
  expect(new TextDecoder().decode(bytes)).toContain("%PDF");
  expect(fake.html).toContain('target-counter(attr(href url), page)'); // page-numbered TOC
  expect(fake.html).toContain('<section class="chapter" id="ch-001">');
});

it("pre-renders diagrams to SVG before layout when a Mermaid renderer is given", async () => {
  const fakeMermaid: MermaidRenderer = {
    renderAll: async (sources) =>
      new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'])),
  };
  const fake = new FakePdf();
  await compilePdf(book(), { mermaid: fakeMermaid, pdf: fake });
  expect(fake.html).toMatch(/<figure class="diagram"[^>]*><svg/); // now carries a per-chapter id
  expect(fake.html).not.toContain("diagram--placeholder");
});
