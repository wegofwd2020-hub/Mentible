import { strToU8, zipSync } from "fflate";
import { extractEpubCover } from "../../src/storage/epubCover";

const CONTAINER =
  '<?xml version="1.0"?><container version="1.0" ' +
  'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
  '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
  "</rootfiles></container>";

function epub(files: Record<string, string | Uint8Array>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(entries).buffer as ArrayBuffer;
}

describe("extractEpubCover", () => {
  it("extracts an SVG cover referenced by properties=cover-image", () => {
    const opf =
      '<?xml version="1.0"?><package><manifest>' +
      '<item id="ci" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>' +
      "</manifest></package>";
    const bytes = epub({
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": opf,
      "OEBPS/cover.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    });
    const cover = extractEpubCover(bytes);
    expect(cover?.svg).toContain("<svg");
    expect(cover?.raster).toBeUndefined();
  });

  it("extracts a raster cover referenced by <meta name='cover'>", () => {
    const opf =
      '<?xml version="1.0"?><package><metadata><meta name="cover" content="cov"/></metadata>' +
      '<manifest><item id="cov" href="images/cover.png" media-type="image/png"/></manifest></package>';
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const cover = extractEpubCover(
      epub({ "META-INF/container.xml": CONTAINER, "OEBPS/content.opf": opf, "OEBPS/images/cover.png": png }),
    );
    expect(cover?.ext).toBe("png");
    expect(new Uint8Array(cover!.raster!)).toEqual(png);
  });

  it("falls back to a cover.* file when the OPF has no cover item", () => {
    const opf = '<?xml version="1.0"?><package><manifest></manifest></package>';
    const cover = extractEpubCover(
      epub({
        "META-INF/container.xml": CONTAINER,
        "OEBPS/content.opf": opf,
        "OEBPS/cover.svg": "<svg/>",
      }),
    );
    expect(cover?.svg).toContain("<svg");
  });

  it("returns null when there is no cover at all", () => {
    const opf = '<?xml version="1.0"?><package><manifest></manifest></package>';
    expect(
      extractEpubCover(epub({ "META-INF/container.xml": CONTAINER, "OEBPS/content.opf": opf })),
    ).toBeNull();
  });

  it("returns null for non-zip bytes", () => {
    expect(extractEpubCover(new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer)).toBeNull();
  });
});
