import { chapterImageMap, MAX_IMAGE_BYTES } from "@/openshelves/epubImages";

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);

describe("chapterImageMap", () => {
  it.each<[string, string]>([
    ["cover.png", "image/png"],
    ["cover.jpg", "image/jpeg"],
    ["cover.jpeg", "image/jpeg"],
    ["cover.webp", "image/webp"],
    ["cover.gif", "image/gif"],
    ["cover.svg", "image/svg+xml"],
  ])("maps %s to the %s data: prefix", (path, mime) => {
    const out = chapterImageMap({ [path]: bytes });
    expect(out[path]).toMatch(new RegExp(`^data:${mime.replace("+", "\\+")};base64,`));
  });

  it("omits an image over the size cap", () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const out = chapterImageMap({ "big.png": huge });
    expect(out["big.png"]).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("keeps an image exactly at the size cap", () => {
    const atCap = new Uint8Array(MAX_IMAGE_BYTES);
    const out = chapterImageMap({ "atcap.png": atCap });
    expect(out["atcap.png"]).toMatch(/^data:image\/png;base64,/);
  });

  it.each(["diagram.bmp", "scan.tiff"])("omits an unknown extension: %s", (path) => {
    const out = chapterImageMap({ [path]: bytes });
    expect(out[path]).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("yields an empty map (total, no throw) for empty input", () => {
    expect(chapterImageMap({})).toEqual({});
  });

  it("keys the map exactly with the zip paths passed in", () => {
    const out = chapterImageMap({
      "images/plate.png": bytes,
      "OEBPS/images/cover.jpg": bytes,
    });
    expect(Object.keys(out).sort()).toEqual(["OEBPS/images/cover.jpg", "images/plate.png"].sort());
  });

  it("never calls fetch (this function makes no request)", () => {
    const spy = jest.spyOn(global, "fetch" as never);
    chapterImageMap({ "a.png": bytes, "b.svg": bytes, "c.bmp": bytes });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Regression: `bytes.slice().buffer` (not `bytes.buffer`) is load-bearing. A
  // zip reader can hand back a Uint8Array that is a VIEW over a larger shared
  // ArrayBuffer (non-zero byteOffset); `.buffer` alone would carry that offset
  // and length through to toBase64 and encode neighbouring bytes too. A future
  // "simplify to `bytes.buffer`" would silently corrupt every such image.
  it("round-trips byte-exact for a Uint8Array view with a non-zero byteOffset", () => {
    const backing = new Uint8Array([0xaa, 0xaa, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0xbb, 0xbb]);
    const view = backing.subarray(2, 7); // byteOffset=2, length=5, same underlying buffer
    expect(view.byteOffset).toBe(2);
    expect(view.buffer.byteLength).toBe(9); // proves it's a view over a LARGER buffer

    const out = chapterImageMap({ "cover.png": view });
    const uri = out["cover.png"];
    expect(uri).toMatch(/^data:image\/png;base64,/);
    const decoded = new Uint8Array(Buffer.from(uri.split(",")[1], "base64"));
    expect(Array.from(decoded)).toEqual(Array.from(view));
  });
});
