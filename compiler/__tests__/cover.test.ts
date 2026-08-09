import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { buildCoverSvg, buildCoverXhtml, coverInputForBook } from "../src/cover";
import { compileEpub } from "../src/epub";
import { STUDIO } from "../src/tokens";
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

// Studio (P4) — the cover is the ONE place the Studio navy is allowed to be a
// full field; the validated-mark accent is gold, not the old brand green, and
// the title carries Playfair Display. This locks the retint and guards against
// stray old brand indigo/green hexes leaking back in.
describe("buildCoverSvg — Studio identity", () => {
  it("uses the Studio navy field, not the old indigo brand field", () => {
    const svg = buildCoverSvg({ title: "Algebra" });
    expect(svg).toContain(STUDIO.navyLuminous);
    expect(svg).toContain(STUDIO.navy);
    expect(svg).not.toContain("#312a8c"); // old BRAND.indigo
    expect(svg).not.toContain("#1e1b4b"); // old BRAND.indigoDark
    expect(svg).not.toContain("#4c1d95"); // old BRAND.indigoLuminous
  });

  it("marks the validated check→arrow in gold, not the old brand green", () => {
    const svg = buildCoverSvg({ title: "Algebra" });
    expect(svg).toContain(STUDIO.goldBright);
    expect(svg).toContain(STUDIO.goldSoft);
    expect(svg).not.toContain("#2a9258"); // old BRAND.green
    expect(svg).not.toContain("#6cc79a"); // old BRAND.greenBright
  });

  it("sets the main title in Playfair Display", () => {
    const svg = buildCoverSvg({ title: "Algebra" });
    expect(svg).toContain("font-family=\"'Playfair Display', 'Source Serif 4', Georgia, serif\"");
  });

  // Only Playfair Display 400/500 are embedded (playfairFont.ts). Requesting
  // font-weight="800" on the main title asks renderers to synthesize a faux
  // bold on the artifact's most prominent text — the exact hazard css.ts and
  // pdf.ts already guard against elsewhere. Weight must match an embedded
  // weight, with font-synthesis:none as a defense-in-depth belt-and-braces.
  it("requests an embedded Playfair weight for the main title, not a synthesized bold", () => {
    const svg = buildCoverSvg({ title: "Algebra" });
    expect(svg).not.toContain('font-weight="800"');
    expect(svg).toMatch(/font-family="'Playfair Display'[^>]*font-weight="500"/);
    expect(svg).toMatch(/font-family="'Playfair Display'[^>]*font-synthesis="none"/);
  });

  it("uses the Studio warm panel for the lower field, not the old lavender", () => {
    const svg = buildCoverSvg({ title: "Algebra" });
    expect(svg).toContain(STUDIO.panel);
    expect(svg).not.toContain("#f5f3ff"); // old BRAND.lavender
  });

  it("keeps the draft-red edition stamp but golds the released edition", () => {
    const draft = buildCoverSvg({ title: "Algebra", edition: "DRAFT" });
    expect(draft).toContain("#b91c1c");
    const released = buildCoverSvg({ title: "Algebra", edition: "v1.0 · First Edition" });
    expect(released).toContain(STUDIO.gold);
  });

  it("the cover XHTML page background is Studio navy, not the old indigo", () => {
    const xhtml = buildCoverXhtml({ title: "Algebra" });
    expect(xhtml).toContain(`background:${STUDIO.navy}`);
    expect(xhtml).not.toContain("#1e1b4b");
  });

  // cover.xhtml is its own EPUB content document — it does NOT link the shared
  // css/style.css (unlike chapters/colophon/TOC), so unless it embeds the
  // Playfair/Source-Serif @font-face itself, the title silently falls back to
  // a generic reader-system serif and never actually renders Playfair.
  it("embeds its own Playfair + Source Serif @font-face (self-contained, no shared stylesheet)", () => {
    const xhtml = buildCoverXhtml({ title: "Algebra" });
    expect(xhtml).toContain("@font-face{font-family:'Playfair Display'");
    expect(xhtml).toContain("@font-face{font-family:'Source Serif 4'");
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
