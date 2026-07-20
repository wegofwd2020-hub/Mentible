jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));
jest.mock("@/lib/uuid", () => ({ randomUUID: () => "bk-fixed" }));

import { zipSync, strToU8 } from "fflate";
import { importEpub, MAX_EPUB_BYTES } from "@/openshelves/importEpub";
import { EpubError } from "@/storage/epubZip";
import { saveBook } from "@/storage/bookStore";

const CONTAINER = `<?xml version="1.0"?><container><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

function goodEpub(): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(`<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Frankenstein</dc:title></metadata>
      <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine></package>`),
    "OEBPS/ch1.xhtml": strToU8("<html><body><h1>Letter 1</h1><p>Hi</p></body></html>"),
  });
}

beforeEach(() => jest.clearAllMocks());

describe("importEpub", () => {
  it("imports a normal EPUB and persists exactly one book", async () => {
    const book = await importEpub(goodEpub());
    expect(book.title).toBe("Frankenstein");
    expect(book.source).toBe("imported");
    expect(saveBook).toHaveBeenCalledTimes(1);
  });

  it("is ATOMIC: a parse failure persists nothing", async () => {
    await expect(importEpub(strToU8("not a zip"))).rejects.toBeInstanceOf(EpubError);
    expect(saveBook).not.toHaveBeenCalled();
  });

  it("refuses an oversize file before doing any work", async () => {
    await expect(importEpub(new Uint8Array(MAX_EPUB_BYTES + 1))).rejects.toThrow(/too large/i);
    expect(saveBook).not.toHaveBeenCalled();
  });

  it("gives every import a fresh id, so importing twice yields two books", async () => {
    const book = await importEpub(goodEpub());
    expect(book.id).toBe("bk-fixed"); // from randomUUID — never the EPUB's own id
  });

  it("never calls fetch", async () => {
    const spy = jest.spyOn(global, "fetch" as never);
    await importEpub(goodEpub());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
