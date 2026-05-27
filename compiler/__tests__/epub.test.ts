import fs from "node:fs";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { compileEpub, EmptyBookError } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

// XML well-formedness check (dependency-free stand-in for full epubcheck, which
// needs Java — see scripts/epubcheck.sh). Strips the html5 DOCTYPE, which the
// validator doesn't model, and asserts the element tree is well-formed.
function assertWellFormed(xml: string, label: string): void {
  const stripped = xml.replace(/<!DOCTYPE[^>]*>/i, "");
  const res = XMLValidator.validate(stripped, { allowBooleanAttributes: true });
  if (res !== true) {
    throw new Error(`${label} is not well-formed XML: ${JSON.stringify(res.err)}`);
  }
}

const LESSON: LessonOutput = {
  topic: "Kinematics",
  level: "intro",
  language: "en",
  synopsis: "Motion in a line. See <https://example.com> & more.",
  learning_objectives: ["Use $v = d/t$"],
  sections: [
    { heading: "Velocity", body_markdown: "Velocity is $v=\\frac{\\Delta x}{\\Delta t}$.\n\n| a | b |\n|---|---|\n| 1 | 2 |" },
  ],
  key_takeaways: ["Velocity is a vector"],
  further_reading: ["A textbook"],
};

function syntheticBook(): Book {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Physics & Friends <Primer>",
    toc: {
      subjects: [
        {
          subject_label: "Mechanics",
          units: [
            { id: "u1", title: "Kinematics", subtopics: [], prerequisites: [] },
            { id: "u-empty", title: "Not generated", subtopics: [], prerequisites: [] },
          ],
        },
      ],
    },
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T12:00:00.000Z",
    content: {
      u1: { topicId: "u1", title: "Kinematics", lesson: LESSON, generatedAt: "2026-05-27T00:00:00.000Z" },
    },
  };
}

async function unzip(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
}

describe("compileEpub — structure & well-formedness (M2/M3)", () => {
  it("throws on a book with no generated content", async () => {
    const empty = syntheticBook();
    empty.content = {};
    await expect(compileEpub(empty)).rejects.toBeInstanceOf(EmptyBookError);
  });

  it("produces a valid EPUB3 OCF structure", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));

    // mimetype present with the exact required value.
    expect(await zip.file("mimetype")!.async("string")).toBe("application/epub+zip");

    // container points at the OPF, which exists.
    const container = await zip.file("META-INF/container.xml")!.async("string");
    expect(container).toContain('full-path="OEBPS/content.opf"');
    expect(zip.file("OEBPS/content.opf")).not.toBeNull();

    // nav + css + title + exactly one chapter (the ungenerated unit is skipped).
    expect(zip.file("OEBPS/nav.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/css/style.css")).not.toBeNull();
    expect(zip.file("OEBPS/chapters/ch-001.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/chapters/ch-002.xhtml")).toBeNull();
  });

  it("writes well-formed XML for every xml/xhtml entry, with escaped metadata", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));
    for (const [path, entry] of Object.entries(zip.files)) {
      if (/\.(xhtml|opf|xml)$/.test(path) && !entry.dir) {
        assertWellFormed(await entry.async("string"), path);
      }
    }
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("Physics &amp; Friends &lt;Primer&gt;"); // title escaped
    expect(opf).toContain('<meta property="dcterms:modified">2026-05-27T12:00:00Z</meta>');
    expect(opf).toContain('properties="mathml"'); // chapter has MathML
  });

  it("every manifest href resolves to a packaged file", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    const hrefs = [...opf.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(zip.file(`OEBPS/${href}`)).not.toBeNull();
    }
  });

  it("emits no script/link-to-CDN dependencies (offline)", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));
    for (const [path, entry] of Object.entries(zip.files)) {
      if (path.endsWith(".xhtml") && !entry.dir) {
        const html = await entry.async("string");
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/cdn\.|jsdelivr|unpkg|katex\.min/i);
        // the only <link> permitted is the local stylesheet
        for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) {
          expect(m[1]).toMatch(/style\.css$/);
        }
      }
    }
  });
});

// The real-content gate: compile the migrated 17-topic book and assert every
// content document is well-formed XML. Skipped automatically if the export
// isn't present on this machine.
const REAL = "/tmp/context-engineering-book.json";
const realDescribe = fs.existsSync(REAL) ? describe : describe.skip;
realDescribe("compileEpub — real migrated book (M3 gate)", () => {
  it("compiles to an EPUB whose every content doc is well-formed XML", async () => {
    const book = JSON.parse(fs.readFileSync(REAL, "utf8")) as Book;
    const zip = await unzip(await compileEpub(book));
    let chapters = 0;
    for (const [path, entry] of Object.entries(zip.files)) {
      if (/\.(xhtml|opf|xml)$/.test(path) && !entry.dir) {
        assertWellFormed(await entry.async("string"), path);
        if (path.startsWith("OEBPS/chapters/")) chapters += 1;
      }
    }
    expect(chapters).toBe(17);
  });
});
