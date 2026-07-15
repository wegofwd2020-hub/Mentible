import {
  mediaDirRel, mediaFileRel, extForMime, MIME_ALLOWLIST,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC,
} from "@/storage/mediaPaths";

describe("mediaPaths", () => {
  it("builds book-scoped relative paths", () => {
    expect(mediaDirRel("bk1")).toBe("media/bk1");
    expect(mediaFileRel("bk1", "img9", "png")).toBe("media/bk1/img9.png");
  });
  it("maps allowed mimes to extensions and rejects others", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/webp")).toBe("webp");
    expect(extForMime("image/gif")).toBeNull();
    expect(MIME_ALLOWLIST).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
  it("exposes caps", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_IMAGES_PER_TOPIC).toBe(20);
  });
});
