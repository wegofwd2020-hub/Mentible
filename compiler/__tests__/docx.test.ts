import { compileDocx } from "../src/docx";
import type { Book } from "../src/types";
import JSZip from "jszip"; // already a compiler dep (used by epub)

const book: Book = {
  id: "b1", title: "Reading Music", createdAt: "", updatedAt: "",
  toc: { subjects: [{ subject_label: "Basics", units: [{ id: "t1", title: "The Staff", subtopics: [], prerequisites: [] }] }] },
  content: {
    t1: {
      topicId: "t1", title: "The Staff", generatedAt: "",
      lesson: {
        topic: "The Staff", level: "", language: "en", synopsis: "",
        learning_objectives: [], key_takeaways: [], further_reading: [],
        sections: [{ heading: "Lines", body_markdown: "The staff has **five** lines." }],
      },
    },
  },
};

it("produces a valid .docx containing the heading and prose", async () => {
  const buf = await compileDocx(book);
  expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // zip magic
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("The Staff"); // topic heading
  expect(xml).toContain("Lines");     // section heading
  expect(xml).toContain("five");      // bold run text
});

it("does not throw on a section with inline math (accepted simplification: renders as text)", async () => {
  const withMath: Book = structuredClone(book);
  withMath.content!.t1.lesson.sections = [{ heading: "Eq", body_markdown: "Energy $E=mc^2$ is famous." }];
  const buf = await compileDocx(withMath); // inline math never calls rasterizeToPng — see docx.ts
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("famous");
});

// This is the test that actually exercises the rasterize-fail → text-fallback
// path: block math ($$...$$) and a ```mermaid fence both route through
// rasterizeToPng (via mathPng/mermaidPng in docx.ts). With puppeteer absent
// (true in this CI environment — it is an optional, non-committed dep, see
// rasterize.ts), both calls throw, get caught, and imageParagraph falls back
// to a text run of the original source instead of failing the whole document.
it("does not throw on block math and a mermaid diagram (rasterize fails → text fallback, without puppeteer)", async () => {
  const withDiagrams: Book = structuredClone(book);
  withDiagrams.content!.t1.lesson.sections = [
    {
      heading: "Eq",
      body_markdown: "Before.\n\n$$\nE=mc^2\n$$\n\nAfter.\n\n```mermaid\ngraph TD; A-->B;\n```\n",
    },
  ];
  const buf = await compileDocx(withDiagrams); // must resolve, not throw
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("Before"); // prose around the fallback still renders
  expect(xml).toContain("After");
  expect(xml).toContain("E=mc^2"); // block-math fallback: raw TeX source text
  expect(xml).toContain("A--&gt;B"); // mermaid fallback: raw diagram source text (XML-escaped)
});

it("renders a GFM table's cell text instead of silently dropping it", async () => {
  const withTable: Book = structuredClone(book);
  withTable.content!.t1.lesson.sections = [
    {
      heading: "Data",
      body_markdown: "| Name | Value |\n|---|---|\n| Alpha | 1 |\n| Beta | 2 |\n",
    },
  ];
  const buf = await compileDocx(withTable);
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("Name");
  expect(xml).toContain("Value");
  expect(xml).toContain("Alpha");
  expect(xml).toContain("Beta");
});
