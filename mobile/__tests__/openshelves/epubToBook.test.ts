import { epubToBook } from "@/openshelves/epubToBook";
import type { ParsedEpub } from "@/openshelves/epubReader";

function parsed(over: Partial<ParsedEpub> = {}): ParsedEpub {
  return {
    metadata: { title: "Frankenstein", authors: ["Mary Shelley"], language: "en" },
    spine: [
      { id: "c1", title: "Letter 1", html: "<p>To Mrs Saville.</p>", images: {} },
      { id: "c2", title: "Letter 2", html: "<p>How slowly.</p>", images: {} },
    ],
    ...over,
  };
}

describe("epubToBook", () => {
  const opts = { id: "bk-1", now: "2026-07-16T00:00:00.000Z" };

  it("maps the spine onto the existing StructuredTOC so the Library works unchanged", () => {
    const b = epubToBook(parsed(), opts);
    expect(b.toc.subjects).toHaveLength(1);
    expect(b.toc.subjects[0].units.map((u) => u.title)).toEqual(["Letter 1", "Letter 2"]);
  });

  it("stores chapters in `chapters`, NEVER in `content`", () => {
    const b = epubToBook(parsed(), opts);
    // `content` means LLM-generated, schema-validated material. An imported
    // chapter is neither — two fields, two meanings.
    expect(b.content).toBeUndefined();
    expect(Object.keys(b.chapters!)).toHaveLength(2);
  });

  it("keys each chapter by its TOC unit id, so the reader can find it", () => {
    const b = epubToBook(parsed(), opts);
    const unitIds = b.toc.subjects[0].units.map((u) => u.id!);
    expect(Object.keys(b.chapters!).sort()).toEqual([...unitIds].sort());
    expect(b.chapters![unitIds[0]].html).toContain("To Mrs Saville.");
  });

  it("stores the chapter html RAW and untouched — no rewriting at import", () => {
    // Import has no DOM (Hermes); rewriting/sanitizing is the render boundary's
    // job (Task 6), not this pure mapping's. A remote/decoy reference must
    // survive here unchanged — it is dropped later, not here.
    const raw = '<p>Look <img src="cover.jpg" data-src="https://evil.example/track.gif"> here.</p>';
    const b = epubToBook(
      parsed({ spine: [{ id: "c1", title: "L1", html: raw, images: {} }] }),
      opts
    );
    const unitId = b.toc.subjects[0].units[0].id!;
    expect(b.chapters![unitId].html).toBe(raw);
  });

  it("populates each chapter's images map from chapterImageMap (zip path → data: URI)", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
    const b = epubToBook(
      parsed({
        spine: [
          { id: "c1", title: "L1", html: "<p>x</p>", images: { "images/cover.png": bytes } },
        ],
      }),
      opts
    );
    const unitId = b.toc.subjects[0].units[0].id!;
    const images = b.chapters![unitId].images;
    expect(Object.keys(images)).toEqual(["images/cover.png"]);
    expect(images["images/cover.png"]).toMatch(/^data:image\/png;base64,/);
  });

  it("marks the book imported and carries its bibliographic metadata", () => {
    const b = epubToBook(parsed(), opts);
    expect(b.source).toBe("imported");
    expect(b.title).toBe("Frankenstein");
    expect(b.metadata?.author).toBe("Mary Shelley");
  });

  it("keeps an empty chapter so the TOC matches the book's real structure", () => {
    const b = epubToBook(
      parsed({ spine: [{ id: "c1", title: "Blank", html: "", images: {} }] }),
      opts
    );
    expect(b.toc.subjects[0].units).toHaveLength(1);
    expect(Object.values(b.chapters!)[0].html).toBe("");
  });

  it("is pure — the same input twice yields the same output", () => {
    expect(epubToBook(parsed(), opts)).toEqual(epubToBook(parsed(), opts));
  });
});
