import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import {
  collectMermaidSources,
  prerenderDiagrams,
  extractSvg,
  type MermaidRenderer,
} from "../src/mermaid";
import { compileEpub } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

// A fake renderer — exercises the two-pass wiring (collect → pre-render → embed)
// without headless Chromium, so this runs in CI. Records the batch it received.
class FakeMermaid implements MermaidRenderer {
  calls: string[][] = [];
  async renderAll(sources: readonly string[]): Promise<Map<string, string>> {
    this.calls.push([...sources]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;
    return new Map(sources.map((s) => [s, svg]));
  }
}

const MERMAID_A = "```mermaid\ngraph TD; A-->B;\n```";
const MERMAID_B = "```mermaid\nsequenceDiagram; X->>Y: hi;\n```";

function lessonWith(...mermaidBlocks: string[]): LessonOutput {
  return {
    topic: "Diagrams",
    level: "intro",
    language: "en",
    synopsis: "Has diagrams.",
    learning_objectives: ["See a diagram"],
    sections: mermaidBlocks.map((b, i) => ({ heading: `S${i}`, body_markdown: b })),
    key_takeaways: ["Diagrams help"],
    further_reading: [],
  };
}

function bookWith(lesson: LessonOutput): Book {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Diagram Book",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    content: { u1: { topicId: "u1", title: "T", lesson, generatedAt: "2026-05-27T00:00:00.000Z" } },
  };
}

describe("extractSvg", () => {
  it("strips the XML prolog and returns the svg root", () => {
    const raw = '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg id="x"><g/></svg>\n';
    expect(extractSvg(raw)).toBe('<svg id="x"><g/></svg>');
  });
});

describe("collectMermaidSources", () => {
  it("collects unique sources across topics in order", () => {
    const sources = collectMermaidSources(bookWith(lessonWith(MERMAID_A, MERMAID_B, MERMAID_A)));
    expect(sources).toEqual(["graph TD; A-->B;", "sequenceDiagram; X->>Y: hi;"]);
  });
});

describe("prerenderDiagrams", () => {
  it("passes the unique (deduped) sources to the batch renderer once", async () => {
    const fake = new FakeMermaid();
    const map = await prerenderDiagrams(bookWith(lessonWith(MERMAID_A, MERMAID_A, MERMAID_B)), fake);
    expect(fake.calls).toHaveLength(1); // one batch
    expect(fake.calls[0]).toEqual(["graph TD; A-->B;", "sequenceDiagram; X->>Y: hi;"]); // deduped
    expect(map.size).toBe(2);
    expect(map.get("graph TD; A-->B;")).toContain("<svg");
  });

  it("a source omitted by the renderer falls back to the placeholder", async () => {
    const flaky: MermaidRenderer = {
      // renders A, omits the sequenceDiagram (as if it failed)
      renderAll: async (sources) =>
        new Map(
          sources
            .filter((s) => !s.includes("sequenceDiagram"))
            .map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"/>']),
        ),
    };
    const map = await prerenderDiagrams(bookWith(lessonWith(MERMAID_A, MERMAID_B)), flaky);
    expect(map.has("graph TD; A-->B;")).toBe(true);
    expect(map.has("sequenceDiagram; X->>Y: hi;")).toBe(false);
  });
});

describe("compileEpub with the mermaid option", () => {
  it("embeds inline SVG, marks the chapter svg, and stays well-formed", async () => {
    const bytes = await compileEpub(bookWith(lessonWith(MERMAID_A)), { mermaid: new FakeMermaid() });
    const zip = await JSZip.loadAsync(bytes);

    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toMatch(/<figure class="diagram"[^>]*><svg/); // now carries a per-chapter id
    expect(chapter).not.toContain("diagram--placeholder");
    expect(XMLValidator.validate(chapter.replace(/<!DOCTYPE[^>]*>/i, ""))).toBe(true);

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toMatch(/properties="[^"]*svg[^"]*"/);
  });

  it("falls back to the placeholder when a diagram fails", async () => {
    const allFail: MermaidRenderer = { renderAll: async () => new Map() }; // nothing rendered
    const bytes = await compileEpub(bookWith(lessonWith(MERMAID_A)), { mermaid: allFail });
    const zip = await JSZip.loadAsync(bytes);
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toContain("diagram--placeholder");
  });
});
