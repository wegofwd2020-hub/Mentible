import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { buildCoverSvg, buildCoverXhtml, coverInputForBook } from "../src/cover";
import { compileEpub } from "../src/epub";
import type { Book } from "../src/types";

function bookWith(overrides: Partial<Book> = {}): Book {
  return {
    id: "bk-1",
    title: "Spec-Driven Development (SDD) For Product Managers",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-27T12:00:00.000Z",
    toc: {
      subjects: [
        { subject_label: "Part I", units: [{ id: "t1", title: "Intro", subtopics: [], prerequisites: [] }] },
      ],
    },
    content: {
      t1: {
        topicId: "t1",
        title: "Intro",
        generatedAt: "2026-05-02T00:00:00.000Z",
        lesson: {
          topic: "Intro",
          level: "intro",
          language: "en",
          synopsis: "Specs turn intent into software.",
          learning_objectives: [],
          sections: [{ heading: "A", body_markdown: "Body." }],
          key_takeaways: [],
          further_reading: [],
        },
      },
    },
    ...overrides,
  };
}

describe("buildCoverSvg", () => {
  it("splits a parenthetical title into main title + subtitle", () => {
    const svg = buildCoverSvg({ title: "Spec-Driven Development (SDD) For Product Managers" });
    expect(svg).toContain("Spec-Driven"); // wrapped main title
    expect(svg).toContain("Development");
    expect(svg).toContain("(SDD) For Product Managers"); // subtitle from the split
    expect(svg).toContain("MENTIBLE"); // brand footer
    expect(svg).toContain("viewBox=\"0 0 1600 2560\"");
  });

  it("uses an explicit subtitle/tagline/brand when given", () => {
    const svg = buildCoverSvg({ title: "Algebra", subtitle: "A Primer", tagline: "Math made plain.", brand: "ACME" });
    expect(svg).toContain("A Primer");
    expect(svg).toContain("Math made plain.");
    expect(svg).toContain("ACME");
  });

  it("renders an author byline when given, and omits it otherwise", () => {
    expect(buildCoverSvg({ title: "Algebra", author: "Sridhar Parthasarathy" })).toContain(
      "by Sridhar Parthasarathy",
    );
    expect(buildCoverSvg({ title: "Algebra" })).not.toContain("by ");
  });

  it("escapes special characters in the title", () => {
    const svg = buildCoverSvg({ title: "Tom & Jerry <Physics>" });
    expect(svg).toContain("Tom &amp; Jerry &lt;Physics&gt;".split(" ")[0]); // "Tom" line carries the &amp;
    expect(svg).not.toMatch(/<Physics>/);
  });

  it("the cover XHTML is well-formed XML with no external links or scripts", () => {
    const xhtml = buildCoverXhtml({ title: "Algebra (Primer)" });
    expect(XMLValidator.validate(xhtml)).toBe(true);
    expect(xhtml).not.toMatch(/<script/i);
    expect(xhtml).not.toMatch(/<link\b/i);
    expect(xhtml).toContain('epub:type="cover"');
  });
});

describe("coverInputForBook", () => {
  it("derives a short tagline from the lead synopsis when punchy", () => {
    expect(coverInputForBook(bookWith()).tagline).toBe("Specs turn intent into software.");
  });

  it("omits the tagline when the lead synopsis sentence is long", () => {
    const b = bookWith();
    b.content!.t1.lesson.synopsis =
      "This lesson introduces the AI-Native Software Era which is a sweeping change across the whole industry and beyond.";
    expect(coverInputForBook(b).tagline).toBeUndefined();
  });

  it("carries the author from book.metadata onto the cover input", () => {
    const b = bookWith({ metadata: { author: "Sridhar Parthasarathy" } });
    expect(coverInputForBook(b).author).toBe("Sridhar Parthasarathy");
    expect(coverInputForBook(bookWith()).author).toBeUndefined();
  });
});

describe("compileEpub — cover wiring", () => {
  it("packages the cover page + cover image and wires them into the OPF", async () => {
    const zip = await JSZip.loadAsync(await compileEpub(bookWith()));
    expect(zip.file("OEBPS/cover.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/cover.svg")).not.toBeNull();

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    // Cover is the first thing in the spine.
    expect(opf.indexOf('<itemref idref="cover"/>')).toBeLessThan(opf.indexOf('<itemref idref="titlepage"/>'));

    // Cover image resolves and is well-formed XML.
    const svg = await zip.file("OEBPS/cover.svg")!.async("string");
    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain("Spec-Driven");
  });
});
