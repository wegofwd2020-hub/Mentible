import { zipSync, strFromU8, strToU8 } from "fflate";
import { openEpub, EpubError, MAX_ZIP_ENTRIES, MAX_INFLATED_BYTES } from "@/storage/epubZip";

const CONTAINER = `<?xml version="1.0"?><container><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

function epub(over: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8('<package><metadata><dc:title>T</dc:title></metadata></package>'),
    ...over,
  });
}

function b4(d: Uint8Array, b: number): number {
  return (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> 0;
}
function w4(d: Uint8Array, b: number, v: number): void {
  d[b] = v & 255;
  d[b + 1] = (v >>> 8) & 255;
  d[b + 2] = (v >>> 16) & 255;
  d[b + 3] = (v >>> 24) & 255;
}

/**
 * Patch a zip's central-directory record so it DECLARES a huge uncompressed
 * size for `name`, while its actual compressed payload stays tiny.
 *
 * A genuine multi-gigabyte zip bomb isn't practical to build (or safe to
 * inflate) inside a unit test. But fflate doesn't need real bulk data to be
 * fooled into a large allocation — it decides how big a buffer to allocate
 * for an entry (`new Uint8Array(declaredOriginalSize)`) purely from this
 * central-directory field, before it has decoded a single byte. Lying about
 * that field exercises the exact code path a real bomb would, without
 * needing gigabytes of test fixture data.
 */
function lieAboutDeclaredSize(zip: Uint8Array, name: string, declaredSize: number): void {
  let e = zip.length - 22;
  while (b4(zip, e) !== 0x06054b50) e--;
  let off = b4(zip, e + 16);
  for (;;) {
    const fnl = zip[off + 28] | (zip[off + 29] << 8);
    const efl = zip[off + 30] | (zip[off + 31] << 8);
    const fcl = zip[off + 32] | (zip[off + 33] << 8);
    const fn = strFromU8(zip.subarray(off + 46, off + 46 + fnl));
    if (fn === name) {
      w4(zip, off + 24, declaredSize); // central-directory "uncompressed size" field
      return;
    }
    off += 46 + fnl + efl + fcl;
  }
}

describe("openEpub", () => {
  it("resolves container.xml → OPF and reports the OPF's directory", () => {
    const z = openEpub(epub());
    expect(z.opfPath).toBe("OEBPS/content.opf");
    expect(z.opfDir).toBe("OEBPS/");
    expect(z.opf).toContain("<dc:title>T</dc:title>");
  });

  it("reports an empty opfDir when the OPF sits at the zip root", () => {
    const z = openEpub(zipSync({
      "META-INF/container.xml": strToU8(CONTAINER.replace("OEBPS/content.opf", "content.opf")),
      "content.opf": strToU8("<package/>"),
    }));
    expect(z.opfDir).toBe("");
  });

  it("finds entries case-insensitively (real EPUBs disagree about case)", () => {
    const z = openEpub(epub());
    expect(z.find("meta-inf/CONTAINER.xml")).toBe("META-INF/container.xml");
  });

  it("refuses a DRM/encrypted book with a clear error rather than rendering garbage", () => {
    const bytes = epub({ "META-INF/encryption.xml": strToU8("<encryption/>") });
    expect(() => openEpub(bytes)).toThrow(EpubError);
    expect(() => openEpub(bytes)).toThrow(/protected|DRM/i);
  });

  it("refuses a zip with too many entries (zip bomb)", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) many[`f${i}.txt`] = strToU8("x");
    expect(() => openEpub(zipSync(many))).toThrow(/too many/i);
  });

  it("refuses a file that is not a zip at all", () => {
    expect(() => openEpub(strToU8("this is not a zip"))).toThrow(EpubError);
  });

  it("refuses an EPUB with no container.xml", () => {
    expect(() => openEpub(zipSync({ "random.txt": strToU8("x") }))).toThrow(/container\.xml/i);
  });

  it("refuses an entry whose DECLARED size exceeds the cap, before it is ever inflated", () => {
    // The entry's real payload is one byte — only its central-directory
    // record's declared uncompressed-size field lies about being oversized.
    // A cap that sums the REAL decoded byte lengths *after* unzipSync
    // finishes would never catch this (the real decoded total is ~1 byte,
    // nowhere near the cap) — even though fflate had already been directed
    // to allocate a declaredSize-sized buffer to inflate into. Only a cap
    // enforced from the declared size, inside the pre-inflation filter,
    // catches it. This is what makes the test discriminating: it fails
    // against a "sum real bytes after unzipSync" implementation, not just
    // against no cap at all.
    const bytes = epub({ "OEBPS/bomb.bin": strToU8("x") });
    lieAboutDeclaredSize(bytes, "OEBPS/bomb.bin", MAX_INFLATED_BYTES + 1024 * 1024);

    expect(() => openEpub(bytes)).toThrow(EpubError);
    expect(() => openEpub(bytes)).toThrow(/too large/i);
  });
});
