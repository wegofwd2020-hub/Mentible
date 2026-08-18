import JSZip from "jszip";
import { parseArgs } from "../src/cli";
import { compilePack, buildMetadataSheet, buildPublishReadme } from "../src/pack";
import { KdpDraftError } from "../src/epub";
import type { Book, BookMetadata, LessonOutput } from "../src/types";

// Stand in for Puppeteer/Chromium (kdpEpubcheck.test.ts's pattern). Both
// compilePack's own cover.jpg raster AND the kdp-profile book.epub's embedded
// cover raster go through renderCoverJpeg -> rasterize.ts's rasterizeToJpeg.
// A real, verified-valid tiny (2x2) JPEG — epubcheck decodes image bytes
// elsewhere in the suite, so this stays a genuine JPEG, not arbitrary bytes.
jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[]) => svgs.map(() => Buffer.from("unused"))),
  rasterizeManyToPngResilient: jest.fn(async (svgs: string[]) => svgs.map(() => Buffer.from("unused"))),
  rasterizeToPng: jest.fn(async () => Buffer.from("unused")),
  rasterizeToJpeg: jest.fn(async () =>
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=",
      "base64",
    ),
  ),
}));

const LESSON: LessonOutput = {
  topic: "Publish Pack Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the publish-pack gate — no math, no diagrams.",
  learning_objectives: ["Understand the pack"],
  sections: [{ heading: "Section", body_markdown: "Plain prose, no math or diagrams." }],
  key_takeaways: ["It packs"],
  further_reading: [],
};

function fixtureBook(metadata: BookMetadata = { author: "Ada Lovelace", status: "release" }): Book {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    title: "Publish Pack Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    metadata,
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-18T00:00:00.000Z" } },
  };
}

describe("parseArgs — --format pack", () => {
  it("recognizes --format pack", () => {
    expect(parseArgs(["book.json", "--format", "pack"]).format).toBe("pack");
  });
});

describe("buildMetadataSheet", () => {
  it("includes the book's title and author", () => {
    const sheet = buildMetadataSheet(fixtureBook());
    expect(sheet).toContain("Publish Pack Fixture");
    expect(sheet).toContain("Ada Lovelace");
  });

  it("labels subtitle, keywords, and BISAC categories as blanks, never invented", () => {
    const sheet = buildMetadataSheet(fixtureBook());
    expect(sheet).toContain("Subtitle:");
    expect(sheet).toContain("Keywords (up to 7):");
    expect(sheet).toContain("Categories (BISAC):");
  });

  it("falls back to em-dash placeholders for absent optional fields", () => {
    const sheet = buildMetadataSheet(fixtureBook({ author: "Ada Lovelace", status: "release" }));
    expect(sheet).toMatch(/ISBN:\s+—/);
    expect(sheet).toMatch(/Translator:\s+—/);
  });
});

describe("buildPublishReadme", () => {
  it("links KDP, Draft2Digital, and PublishDrive, and notes Apple without linking it", () => {
    const readme = buildPublishReadme(fixtureBook());
    expect(readme).toContain("kdp.amazon.com");
    expect(readme).toContain("draft2digital.com");
    expect(readme).toContain("publishdrive.com");
    expect(readme).toMatch(/Apple Books direct requires a Mac/);
    expect(readme).not.toContain('href="https://apple.com');
    expect(readme).not.toContain("ingramspark");
  });

  it("escapes a book title with HTML-significant characters", () => {
    const book = fixtureBook();
    book.title = "Cats & <Dogs>";
    const readme = buildPublishReadme(book);
    expect(readme).toContain("Cats &amp; &lt;Dogs&gt;");
    expect(readme).not.toContain("<Dogs>");
  });
});

describe("compilePack", () => {
  it("zips exactly book.epub, cover.jpg, metadata.txt, and README.html", async () => {
    const buf = await compilePack(fixtureBook());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(
      ["README.html", "book.epub", "cover.jpg", "metadata.txt"].sort(),
    );
  });

  it("book.epub starts with the EPUB PK magic", async () => {
    const buf = await compilePack(fixtureBook());
    const zip = await JSZip.loadAsync(buf);
    const epubBytes = await zip.file("book.epub")!.async("nodebuffer");
    expect(epubBytes.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("metadata.txt and README.html carry the book's content", async () => {
    const buf = await compilePack(fixtureBook());
    const zip = await JSZip.loadAsync(buf);
    const metadataTxt = await zip.file("metadata.txt")!.async("string");
    const readme = await zip.file("README.html")!.async("string");
    expect(metadataTxt).toContain("Publish Pack Fixture");
    expect(readme).toContain("kdp.amazon.com");
  });

  it("refuses to compile a draft book (inherits the KDP draft guard)", async () => {
    await expect(
      compilePack(fixtureBook({ author: "Ada Lovelace", status: "draft" })),
    ).rejects.toBeInstanceOf(KdpDraftError);
  });
});
