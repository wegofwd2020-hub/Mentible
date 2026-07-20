import { zipSync, strToU8 } from "fflate";
import { readEpub } from "@/openshelves/epubReader";
import { EpubError } from "@/storage/epubZip";

const CONTAINER = `<?xml version="1.0"?><container><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

function opf(body: string): string {
  return `<?xml version="1.0"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Frankenstein</dc:title>
    <dc:creator>Mary Shelley</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  ${body}
</package>`;
}

function book(extra: Record<string, Uint8Array> = {}, body?: string): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(opf(body ?? `
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>`)),
    "OEBPS/ch1.xhtml": strToU8("<html><body><h1>Letter 1</h1><p>To Mrs Saville.</p></body></html>"),
    "OEBPS/ch2.xhtml": strToU8("<html><body><h1>Letter 2</h1><p>How slowly the time passes.</p></body></html>"),
    ...extra,
  });
}

describe("readEpub", () => {
  it("reads the book's metadata", () => {
    const p = readEpub(book());
    expect(p.metadata.title).toBe("Frankenstein");
    expect(p.metadata.authors).toEqual(["Mary Shelley"]);
    expect(p.metadata.language).toBe("en");
  });

  it("returns chapters in SPINE order, not manifest or zip order", () => {
    const p = readEpub(book({}, `
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c2"/><itemref idref="c1"/></spine>`));
    expect(p.spine.map((s) => s.id)).toEqual(["c2", "c1"]);
    expect(p.spine[0].html).toContain("Letter 2");
  });

  it("titles each chapter from its first heading, falling back to a positional label", () => {
    const p = readEpub(book());
    expect(p.spine[0].title).toBe("Letter 1");
    const untitled = readEpub(book({ "OEBPS/ch1.xhtml": strToU8("<html><body><p>no heading</p></body></html>") }));
    expect(untitled.spine[0].title).toBe("Chapter 1");
  });

  it("collects each chapter's referenced images from inside the zip", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const p = readEpub(book({
      "OEBPS/ch1.xhtml": strToU8('<html><body><img src="images/plate.png"/></body></html>'),
      "OEBPS/images/plate.png": png,
    }));
    expect(Object.keys(p.spine[0].images)).toEqual(["images/plate.png"]);
    expect(p.spine[0].images["images/plate.png"]).toEqual(png);
  });

  it("does NOT collect remote images — they must never be fetched", () => {
    const p = readEpub(book({
      "OEBPS/ch1.xhtml": strToU8('<html><body><img src="https://evil.example/track.png"/></body></html>'),
    }));
    expect(Object.keys(p.spine[0].images)).toEqual([]);
  });

  it("keeps a chapter whose body is empty rather than dropping it (TOC must match the book)", () => {
    const p = readEpub(book({ "OEBPS/ch1.xhtml": strToU8("<html><body></body></html>") }));
    expect(p.spine).toHaveLength(2);
  });

  it("refuses an OPF that declares an external (SYSTEM) entity, rather than silently parsing around it", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x SYSTEM "file:///etc/passwd">]>` + opf(`
      <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>`);
    const bytes = zipSync({
      "META-INF/container.xml": strToU8(CONTAINER),
      "OEBPS/content.opf": strToU8(xxe),
      "OEBPS/ch1.xhtml": strToU8("<html><body><p>hi</p></body></html>"),
    });
    let thrown: unknown;
    try {
      readEpub(bytes);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EpubError);
    // Belt-and-suspenders: nothing resembling file contents leaks into the error either.
    expect(JSON.stringify((thrown as Error)?.message ?? "")).not.toContain("root:");
  });

  it("parses a benign DOCTYPE (no internal subset) normally — proves refusal is scoped to external entities, not DOCTYPE itself", () => {
    const benign = `<?xml version="1.0"?><!DOCTYPE package PUBLIC "-//OASIS//DTD DocBook XML V4.1.2//EN" "http://www.oasis-open.org/docbook/xml/4.1.2/docbookx.dtd">` + opf(`
      <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>`);
    const p = readEpub(zipSync({
      "META-INF/container.xml": strToU8(CONTAINER),
      "OEBPS/content.opf": strToU8(benign),
      "OEBPS/ch1.xhtml": strToU8("<html><body><p>hi</p></body></html>"),
    }));
    expect(p.spine).toHaveLength(1);
    expect(p.metadata.title).toBe("Frankenstein");
  });

  it("never expands an inline entity reference in the OPF — it must come back literal (guards processEntities: false)", () => {
    const withEntityRef = `<?xml version="1.0"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Franken&amp;stein</dc:title>
    <dc:creator>Mary Shelley</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
    const p = readEpub(zipSync({
      "META-INF/container.xml": strToU8(CONTAINER),
      "OEBPS/content.opf": strToU8(withEntityRef),
      "OEBPS/ch1.xhtml": strToU8("<html><body><p>hi</p></body></html>"),
    }));
    // With processEntities:false, the builtin &amp; reference is left as literal
    // text ("&amp;"), never decoded to "&". If this ever comes back as
    // "Franken&stein", `processEntities` was flipped to `true` — that's the bug
    // this test exists to catch.
    expect(p.metadata.title).toBe("Franken&amp;stein");
  });

  it("refuses a book with no spine", () => {
    expect(() => readEpub(book({}, "<manifest/><spine/>"))).toThrow(EpubError);
  });
});
