/**
 * @jest-environment jsdom
 */
// jsdom: the security half of this test renders through the WEB boundary, and
// DOMPurify needs a real DOM. (RNTL's default environment has none.)
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));
jest.mock("@/lib/uuid", () => ({ randomUUID: () => "bk-e2e" }));

import { readFileSync } from "node:fs";
import { importEpub } from "@/openshelves/importEpub";
import { renderChapterToSafeHtml } from "@/reader/renderContent";
import { EpubError } from "@/storage/epubZip";

const good = () => new Uint8Array(readFileSync("assets/test-epubs/good.epub"));
const drm = () => new Uint8Array(readFileSync("assets/test-epubs/drm.epub"));

describe("F1 end-to-end on a real EPUB — import keeps the bytes, render makes them safe", () => {
  it("imports a real EPUB: metadata, spine order, and a working TOC", async () => {
    const book = await importEpub(good());
    expect(book.title).toBe("The Test Book");
    expect(book.metadata?.author).toBe("A. Fixture");
    expect(book.source).toBe("imported");
    expect(book.toc.subjects[0].units.map((u) => u.title))
      .toEqual(["The First Chapter", "The Second Chapter"]);
  });

  it("stores the chapter RAW and carries its image in the map, keyed by the src as written", async () => {
    // The refs-in-schema shape (mirrors media slice 1): bytes live beside the
    // HTML, not inside it. Import does NOT rewrite tags — five regex attempts
    // proved that unwinnable on a DOM-less platform.
    const book = await importEpub(good());
    const ch1 = Object.values(book.chapters!)[0];
    expect(ch1.html).toContain("../images/plate.png");       // raw, untouched
    expect(ch1.images["../images/plate.png"]).toMatch(/^data:image\/png;base64,/);
  });

  it("keeps a hostile chapter's bytes verbatim at rest — the guarantee is at RENDER, not import", async () => {
    const book = await importEpub(good());
    const ch2 = Object.values(book.chapters!)[1];
    expect(ch2.html).toContain("evil.example"); // BY DESIGN. See the render test below.
    expect(ch2.html).toContain("<script");      // BY DESIGN.
  });

  it("RENDER resolves the book's own image from the map and keeps its alt text", async () => {
    const book = await importEpub(good());
    const html = renderChapterToSafeHtml(Object.values(book.chapters!)[0]);
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('alt="A plate"');
    expect(html).not.toContain("../images/plate.png"); // the zip path is gone
    expect(html).toContain("Real prose.");             // the real content survives
  });

  it("RENDER drops the chapter's script and its remote tracking image", async () => {
    const book = await importEpub(good());
    const html = renderChapterToSafeHtml(Object.values(book.chapters!)[1]);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<script");
    expect(html).toContain("More prose."); // over-refusal check: real content survives
  });

  it("refuses a DRM'd book with a message a user can act on", async () => {
    await expect(importEpub(drm())).rejects.toBeInstanceOf(EpubError);
    await expect(importEpub(drm())).rejects.toThrow(/copy-protected/i);
  });
});
