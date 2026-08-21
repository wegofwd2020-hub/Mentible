import { packEpubBody, unpackEpubBody } from "@/sync/epubFraming";

describe("epubFraming", () => {
  describe("packEpubBody", () => {
    it("should pack meta and epub with big-endian length prefix", () => {
      const meta = new Uint8Array([1, 2, 3]);
      const epub = new Uint8Array([4, 5, 6, 7]);
      const packed = packEpubBody(meta, epub);

      expect(packed.length).toBe(4 + 3 + 4);
      expect(packed.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 3])); // meta.length=3 in big-endian
      expect(packed.slice(4, 7)).toEqual(new Uint8Array([1, 2, 3]));
      expect(packed.slice(7, 11)).toEqual(new Uint8Array([4, 5, 6, 7]));
    });

    it("should handle empty meta", () => {
      const meta = new Uint8Array(0);
      const epub = new Uint8Array([1, 2, 3]);
      const packed = packEpubBody(meta, epub);

      expect(packed.length).toBe(4 + 3);
      expect(packed.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 0])); // meta.length=0
      expect(packed.slice(4, 7)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("should encode meta.length as big-endian uint32", () => {
      const meta = new Uint8Array(300); // 0x000000000000012c in big-endian is [0, 0, 1, 44]
      const epub = new Uint8Array(0);
      const packed = packEpubBody(meta, epub);

      expect(packed.slice(0, 4)).toEqual(new Uint8Array([0, 0, 1, 44]));
    });
  });

  describe("unpackEpubBody", () => {
    it("should unpack and return meta and epub", () => {
      const meta = new Uint8Array([1, 2, 3]);
      const epub = new Uint8Array([4, 5, 6, 7]);
      const packed = packEpubBody(meta, epub);

      const { metaCt, epubCt } = unpackEpubBody(packed);
      expect(metaCt).toEqual(meta);
      expect(epubCt).toEqual(epub);
    });

    it("should throw on body too short (< 4 bytes)", () => {
      expect(() => unpackEpubBody(new Uint8Array([1, 2, 3]))).toThrow(
        "epub body too short"
      );
    });

    it("should throw when meta_len exceeds body", () => {
      // Create a body that claims meta.length=100 but only has 10 bytes total
      const body = new Uint8Array(10);
      new DataView(body.buffer).setUint32(0, 100, false); // claim meta is 100 bytes
      expect(() => unpackEpubBody(body)).toThrow("epub body: meta_len exceeds body");
    });

    it("should handle empty meta correctly", () => {
      const meta = new Uint8Array(0);
      const epub = new Uint8Array([1, 2, 3]);
      const packed = packEpubBody(meta, epub);

      const { metaCt, epubCt } = unpackEpubBody(packed);
      expect(metaCt.length).toBe(0);
      expect(epubCt).toEqual(epub);
    });
  });

  describe("round-trip", () => {
    it("should round-trip small buffers", () => {
      const meta = new Uint8Array([10, 20, 30]);
      const epub = new Uint8Array([40, 50, 60, 70, 80]);

      const packed = packEpubBody(meta, epub);
      const { metaCt, epubCt } = unpackEpubBody(packed);

      expect(metaCt).toEqual(meta);
      expect(epubCt).toEqual(epub);
    });

    it("should round-trip large epub (5 MB)", () => {
      // Create a 5 MB epub with an index pattern to verify no corruption
      const largeEpub = new Uint8Array(5 * 1024 * 1024);
      for (let i = 0; i < largeEpub.length; i++) {
        largeEpub[i] = (i % 256) & 0xff;
      }

      const meta = new Uint8Array([1, 2, 3, 4, 5]);

      const packed = packEpubBody(meta, largeEpub);
      const { metaCt, epubCt } = unpackEpubBody(packed);

      expect(metaCt).toEqual(meta);
      expect(epubCt).toEqual(largeEpub);
      // Spot-check a few bytes to ensure no corruption
      expect(epubCt[0]).toBe(0);
      expect(epubCt[256]).toBe(0);
      expect(epubCt[257]).toBe(1);
    });

    it("should handle empty meta in round-trip", () => {
      const meta = new Uint8Array(0);
      const epub = new Uint8Array([1, 2, 3, 4]);

      const packed = packEpubBody(meta, epub);
      const { metaCt, epubCt } = unpackEpubBody(packed);

      expect(metaCt.length).toBe(0);
      expect(epubCt).toEqual(epub);
    });
  });

  describe("offset safety", () => {
    it("should correctly unpack a body that is a subarray of a larger buffer", () => {
      // Create a larger buffer and place the packed data in the middle
      const largeBuffer = new Uint8Array(1000);

      const meta = new Uint8Array([11, 22, 33]);
      const epub = new Uint8Array([44, 55, 66, 77]);
      const packed = packEpubBody(meta, epub);

      // Place packed at offset 100
      largeBuffer.set(packed, 100);

      // Now take a subarray view starting at offset 100
      const body = largeBuffer.subarray(100, 100 + packed.length);

      // unpackEpubBody must handle the nonzero byteOffset
      const { metaCt, epubCt } = unpackEpubBody(body);

      expect(metaCt).toEqual(meta);
      expect(epubCt).toEqual(epub);
    });

    it("should correctly read big-endian from a subarray with nonzero byteOffset", () => {
      const meta = new Uint8Array(5);
      const epub = new Uint8Array(10);
      const packed = packEpubBody(meta, epub);

      // Create a buffer large enough to hold packed at offset 2
      const largeBuffer = new Uint8Array(2 + packed.length + 5);
      largeBuffer.set(packed, 2); // offset 2

      const body = largeBuffer.subarray(2, 2 + packed.length);

      // Verify the length is read correctly despite the offset
      const { metaCt } = unpackEpubBody(body);
      expect(metaCt.length).toBe(5);
    });
  });
});
