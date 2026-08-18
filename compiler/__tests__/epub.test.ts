import fs from "node:fs";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { compileEpub, EmptyBookError, KdpDraftError, isoDate } from "../src/epub";
import type { Book, BookMetadata, LessonOutput } from "../src/types";

// Stand in for Puppeteer/Chromium (D3/D4/D5 raster paths) so these tests never
// need real Chromium. Also stands in for Task 6's cover-JPEG call, exercised
// unconditionally once that lands.
jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[], _w: number, _omit?: boolean) =>
    svgs.map((_, i) => Buffer.from(`fake-png-${i}`)),
  ),
  rasterizeManyToPngResilient: jest.fn(async (svgs: string[], _w: number, _omit?: boolean) =>
    svgs.map((_, i) => Buffer.from(`fake-png-${i}`)),
  ),
  rasterizeToPng: jest.fn(async () => Buffer.from("fake-png-cover")),
  rasterizeToJpeg: jest.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0x00])), // real JPEG magic number
}));

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

function bookWithMermaidDiagram(): Book {
  const book = syntheticBook();
  book.content!.u1.lesson!.sections.push({
    heading: "Flow",
    body_markdown: "```mermaid\ngraph TD; A-->B;\n```",
  });
  return book;
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

  it("profile 'default' (explicit) compiles to the exact same bytes as omitting profile", async () => {
    const withoutOpt = await compileEpub(syntheticBook());
    const withDefault = await compileEpub(syntheticBook(), { profile: "default" });
    expect(Buffer.from(withDefault)).toEqual(Buffer.from(withoutOpt));
  });

  it("profile 'kdp' writes KDP_STYLESHEET instead of STYLESHEET", async () => {
    const zip = await unzip(await compileEpub(syntheticBook(), { profile: "kdp" }));
    const css = await zip.file("OEBPS/css/style.css")!.async("string");
    expect(css).not.toContain("@font-face");
    expect(css).toMatch(/table\s*\{/); // headings/tables kept
  });

  it("profile 'kdp' rasterizes math to <img>, dropping <math> from the chapter", async () => {
    const book = syntheticBook(); // LESSON's Velocity section has $v=\frac{\Delta x}{\Delta t}$
    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).not.toContain("<math");
    expect(chapter).toMatch(/<img class="math math-(inline|block)" alt="[^"]*"/);
  });

  it("profile 'kdp' rasterizes BOTH an inline and a display-block equation through the real KaTeX render path", async () => {
    const book: Book = JSON.parse(JSON.stringify(syntheticBook()));
    book.content!.u1.lesson!.sections[0].body_markdown += "\n\n$$\nE=mc^2\n$$";
    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).not.toContain("<math");
    expect(chapter).toMatch(/<img class="math math-inline" alt="[^"]*"/);
    expect(chapter).toMatch(/<img class="math math-block" alt="[^"]*"/);
  });

  it("profile 'kdp' + mermaid rasterizes diagrams to <img>, not inline <svg>", async () => {
    const book = bookWithMermaidDiagram();
    const fakeMermaid = { renderAll: async (sources: readonly string[]) => new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'])) };
    const zip = await unzip(await compileEpub(book, { mermaid: fakeMermaid, profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toMatch(/<figure class="diagram"[^>]*><img src="\.\.\/images\/img-\d+\.png"/);
    expect(chapter).not.toContain("<svg");
  });

  it("default profile + mermaid keeps diagrams as inline <svg> (no rasterization)", async () => {
    const book = bookWithMermaidDiagram();
    const fakeMermaid = { renderAll: async (sources: readonly string[]) => new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'])) };
    const zip = await unzip(await compileEpub(book, { mermaid: fakeMermaid }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toContain("<svg");
    expect(chapter).not.toContain('<img src="data:image/png;base64,');
  });

  it("profile 'kdp' + mermaid: a diagram that fails to rasterize falls back to the inline-SVG/placeholder figure while the rest become <img> (partial-failure fallback)", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    const book = bookWithMermaidDiagram();
    book.content!.u1.lesson!.sections.push({
      heading: "Flow 2",
      body_markdown: "```mermaid\nsequenceDiagram; X->>Y: hi;\n```",
    });
    const svgFor = (s: string) => `<svg xmlns="http://www.w3.org/2000/svg" data-src="${s}"><rect width="1" height="1"/></svg>`;
    const fakeMermaid = {
      renderAll: async (sources: readonly string[]) => new Map(sources.map((s) => [s, svgFor(s)])),
    };
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((svg: string) => (svg.includes("sequenceDiagram") ? null : Buffer.from("ok"))),
    );
    const zip = await unzip(await compileEpub(book, { mermaid: fakeMermaid, profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toMatch(/<figure class="diagram"[^>]*><img src="\.\.\/images\/img-\d+\.png"/); // rasterized
    expect(chapter).toContain("sequenceDiagram"); // failed diagram — falls back to placeholder text, not <img>
    expect(chapter).toContain('class="diagram diagram--placeholder"'); // fallback is the text placeholder, not the raw inline SVG
    expect(chapter).not.toContain("<svg"); // never leaks the raw pre-rasterized SVG either
  });

  it("produces a valid EPUB3 OCF structure", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));

    // mimetype present with the exact required value.
    expect(await zip.file("mimetype")!.async("string")).toBe("application/epub+zip");

    // container points at the OPF, which exists.
    const container = await zip.file("META-INF/container.xml")!.async("string");
    expect(container).toContain('full-path="OEBPS/content.opf"');
    expect(zip.file("OEBPS/content.opf")).not.toBeNull();

    // EPUB2 NCX fallback present + referenced from the spine (traditional readers).
    expect(zip.file("OEBPS/toc.ncx")).not.toBeNull();
    const ncx = await zip.file("OEBPS/toc.ncx")!.async("string");
    expect(ncx).toContain("<navPoint");
    expect(ncx).toContain('src="chapters/ch-001.xhtml"');
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<spine toc="ncx">');
    expect(opf).toContain('media-type="application/x-dtbncx+xml"');

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

describe("compileEpub — bibliographic metadata → OPF + colophon", () => {
  function withMeta(metadata: BookMetadata): Book {
    return { ...syntheticBook(), metadata };
  }

  it("emits dc:* metadata from Book.metadata and a colophon in the spine", async () => {
    const zip = await unzip(
      await compileEpub(
        withMeta({
          author: "Jane Doe",
          authorFileAs: "Doe, Jane",
          publisher: "Mentible",
          language: "en",
          description: "A guide.",
          subjects: ["AI", "Product"],
          rights: "(c) 2026 Jane Doe.",
          date: "2026",
          identifier: "urn:uuid:abc",
        }),
      ),
    );
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<dc:creator id="creator">Jane Doe</dc:creator>');
    expect(opf).toContain('property="role" scheme="marc:relators">aut<');
    expect(opf).toContain('property="file-as">Doe, Jane<');
    expect(opf).toContain("<dc:publisher>Mentible</dc:publisher>");
    expect(opf).toContain("<dc:description>A guide.</dc:description>");
    expect(opf).toContain("<dc:subject>AI</dc:subject>");
    expect(opf).toContain("<dc:subject>Product</dc:subject>");
    expect(opf).toContain("<dc:date>2026</dc:date>");
    expect(opf).toContain('<dc:identifier id="bookid">urn:uuid:abc</dc:identifier>');

    // colophon packaged + in the spine, after the title page, before chapter 1
    expect(zip.file("OEBPS/colophon.xhtml")).not.toBeNull();
    expect(opf.indexOf('<itemref idref="titlepage"/>')).toBeLessThan(
      opf.indexOf('<itemref idref="colophon"/>'),
    );
    expect(opf.indexOf('<itemref idref="colophon"/>')).toBeLessThan(
      opf.indexOf('<itemref idref="ch001"/>'),
    );
    const col = await zip.file("OEBPS/colophon.xhtml")!.async("string");
    assertWellFormed(col, "colophon.xhtml");
    expect(col).toContain("by Jane Doe");
    expect(col).toContain("Jane Doe.");
  });

  it("honours metadata.language in dc:language and xml:lang", async () => {
    const zip = await unzip(await compileEpub(withMeta({ language: "fr" })));
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("<dc:language>fr</dc:language>");
    expect(opf).toContain('xml:lang="fr"');
    const col = await zip.file("OEBPS/colophon.xhtml")!.async("string");
    expect(col).toContain('xml:lang="fr"');
  });

  it("defaults language to en and synthesises a rights line when metadata is absent", async () => {
    const zip = await unzip(await compileEpub(syntheticBook())); // no metadata
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("<dc:language>en</dc:language>");
    expect(zip.file("OEBPS/colophon.xhtml")).not.toBeNull();
    const col = await zip.file("OEBPS/colophon.xhtml")!.async("string");
    expect(col).toContain("All rights reserved.");
  });

  it("profile 'kdp' registers a JPEG cover-image and drops the vector cover.svg", async () => {
    const book = withMeta({ author: "A", status: "release" });
    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    expect(zip.file("OEBPS/cover.svg")).toBeNull();
    const coverJpg = await zip.file("OEBPS/cover.jpg")!.async("nodebuffer");
    expect(coverJpg[0]).toBe(0xff); // JPEG magic number, from the mocked rasterizeToJpeg
    expect(coverJpg[1]).toBe(0xd8);
    expect(coverJpg[2]).toBe(0xff);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>');
    const coverXhtml = await zip.file("OEBPS/cover.xhtml")!.async("string");
    expect(coverXhtml).toContain('<img src="cover.jpg"');
  });

  it("profile 'kdp' normalizes dc:date to ISO-8601 and leaves the default profile's date untouched", async () => {
    const book = withMeta({ author: "A", status: "release", date: "June 1, 2026" });
    const kdpOpf = await (await unzip(await compileEpub(book, { profile: "kdp" }))).file("OEBPS/content.opf")!.async("string");
    expect(kdpOpf).toContain("<dc:date>2026-06-01</dc:date>");
    const defaultOpf = await (await unzip(await compileEpub(book))).file("OEBPS/content.opf")!.async("string");
    expect(defaultOpf).toContain("<dc:date>June 1, 2026</dc:date>");
  });

  it("profile 'kdp' emits a translator contributor and an ISBN identifier when present", async () => {
    const book = withMeta({ author: "A", status: "release", translator: "T. Ranslator", isbn: "9780000000000" });
    const opf = await (await unzip(await compileEpub(book, { profile: "kdp" }))).file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<dc:contributor id="translator">T. Ranslator</dc:contributor>');
    expect(opf).toContain('scheme="marc:relators">trl</meta>');
    expect(opf).toContain('<dc:identifier id="isbn">9780000000000</dc:identifier>');
  });

  it("profile 'kdp' refuses to compile a draft book with a clear error", async () => {
    const book = withMeta({ author: "A", status: "draft" });
    await expect(compileEpub(book, { profile: "kdp" })).rejects.toThrow(/kdp export profile requires a released book/i);
  });

  it("profile 'default' still compiles a draft book (no guard)", async () => {
    const book = withMeta({ author: "A", status: "draft" });
    await expect(compileEpub(book)).resolves.toBeInstanceOf(Uint8Array);
  });

  // Pin: backend/src/export/compiler.py greps this exact substring (case-
  // insensitively) against the compiler subprocess's stderr to map a kdp
  // draft-refusal to a friendly 422 instead of a generic 500. There is no
  // shared constant across the TS/Python boundary, so a reword here that
  // drops this substring would keep every other test green while silently
  // breaking that mapping in production — this test is the only thing
  // pinning it. Keep in sync with the "kdp export profile requires a
  // released book" check in compiler.py.
  it("KdpDraftError's message contains the substring the backend greps for", () => {
    expect(new KdpDraftError().message.toLowerCase()).toContain(
      "kdp export profile requires a released book",
    );
  });
});

// Timezone-immune by construction (never round-trips through toISOString()),
// so these hold regardless of the test-runner's TZ.
describe("isoDate", () => {
  it("parses a loose month+year civil string", () => {
    expect(isoDate("Jan 2026")).toBe("2026-01-01");
  });

  it("parses a loose day+month+year civil string", () => {
    expect(isoDate("June 1, 2026")).toBe("2026-06-01");
  });

  it("takes an already-ISO date verbatim", () => {
    expect(isoDate("2026-06-01")).toBe("2026-06-01");
  });

  it("takes the date part of an ISO datetime with a Z suffix verbatim", () => {
    expect(isoDate("2026-06-01T23:00:00Z")).toBe("2026-06-01");
  });

  it("passes an unparseable string through unchanged", () => {
    expect(isoDate("not a date")).toBe("not a date");
  });
});

describe("compileEpub — accessibility metadata (EPUB Accessibility 1.1)", () => {
  // syntheticBook has math (KaTeX → <math>) and a table, but no diagrams/images.
  it("auto-derives a11y metadata from content: textual access + MathML, no visual mode", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<meta property="schema:accessMode">textual</meta>');
    expect(opf).not.toContain('<meta property="schema:accessMode">visual</meta>');
    expect(opf).toContain('<meta property="schema:accessModeSufficient">textual</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">MathML</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">structuralNavigation</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">tableOfContents</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityHazard">none</meta>');
    expect(opf).toMatch(/<meta property="schema:accessibilitySummary">[^<]*MathML/);
    assertWellFormed(opf, "content.opf");
  });

  it("profile 'kdp' flips the MathML feature to alternativeText (math is rasterized, not MathML anymore)", async () => {
    const zip = await unzip(await compileEpub(syntheticBook(), { profile: "kdp" }));
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain('<meta property="schema:accessibilityFeature">MathML</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
    expect(opf).toMatch(/<meta property="schema:accessibilitySummary">[^<]*text alternative/);
    assertWellFormed(opf, "content.opf");
  });

  it("profile 'kdp' reports BOTH MathML and alternativeText when only some equations in the book rasterize (partial-failure fallback)", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    const book: Book = JSON.parse(JSON.stringify(syntheticBook()));
    book.content!.u1.lesson!.sections[0].body_markdown += "\n\n$$\nE=mc^2\n$$";
    // Let the inline $v=...$ equation rasterize; fail the E=mc^2 block equation
    // specifically — it should fall back to MathML while the other becomes <img>.
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((svg: string) => (svg.includes("E=mc^2") ? null : Buffer.from("ok"))),
    );

    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toContain("<math"); // the failed equation stayed MathML
    expect(chapter).toMatch(/<img class="math math-inline"/); // the other rasterized fine

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<meta property="schema:accessibilityFeature">MathML</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
    assertWellFormed(opf, "content.opf");
  });

  it("adds a visual access mode when the content carries diagrams/SVG", async () => {
    // Deep-clone: syntheticBook() shares a module-level LESSON object, so mutate
    // a copy to avoid bleeding into other tests.
    const book: Book = JSON.parse(JSON.stringify(syntheticBook()));
    book.content!.u1.lesson!.sections[0].body_markdown =
      'Here is a figure.\n\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const opf = await (await unzip(await compileEpub(book))).file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<meta property="schema:accessMode">visual</meta>');
    expect(opf).toContain('<meta property="schema:accessModeSufficient">textual,visual</meta>');
  });

  it("lets the author override/extend and assert formal conformance", async () => {
    const book: Book = {
      ...syntheticBook(),
      metadata: {
        accessibility: {
          summary: "Audited; all figures have text alternatives.",
          features: ["alternativeText"],
          hazards: ["noFlashingHazard", "noSoundHazard"],
          accessModeSufficient: ["textual"],
          conformsTo: "https://www.w3.org/TR/epub-a11y-11/#sec-conf-wcag-aa",
          certifiedBy: "Acme Accessibility Audits",
        },
      },
    };
    const opf = await (await unzip(await compileEpub(book))).file("OEBPS/content.opf")!.async("string");
    // author summary/hazards/sufficient replace the defaults
    expect(opf).toContain('<meta property="schema:accessibilitySummary">Audited; all figures have text alternatives.</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityHazard">noFlashingHazard</meta>');
    expect(opf).not.toContain('<meta property="schema:accessibilityHazard">none</meta>');
    // author features MERGE with the auto-detected ones (MathML still present)
    expect(opf).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">MathML</meta>');
    // formal conformance only when asserted
    expect(opf).toContain('<link rel="dcterms:conformsTo" href="https://www.w3.org/TR/epub-a11y-11/#sec-conf-wcag-aa"/>');
    expect(opf).toContain('<meta property="a11y:certifiedBy">Acme Accessibility Audits</meta>');
    assertWellFormed(opf, "content.opf");
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
