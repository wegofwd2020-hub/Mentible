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

it("does not throw on a section with math (falls back without puppeteer)", async () => {
  const withMath: Book = structuredClone(book);
  withMath.content!.t1.lesson.sections = [{ heading: "Eq", body_markdown: "Energy $E=mc^2$ is famous." }];
  const buf = await compileDocx(withMath); // puppeteer absent → math falls back to text, whole doc still compiles
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("famous");
});
