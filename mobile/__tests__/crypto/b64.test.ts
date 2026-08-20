import { bytesToBase64, base64ToBytes } from "@/crypto/b64";

describe("bytesToBase64 / base64ToBytes round-trip", () => {
  it("round-trips empty bytes", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });

  it("round-trips arbitrary byte lengths (padding cases 0/1/2)", () => {
    for (const len of [1, 2, 3, 4, 5, 6, 7, 15, 16, 17, 31, 32, 33]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) % 256;
      const b64 = bytesToBase64(bytes);
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });

  it("round-trips full-range random bytes (32B key-shaped)", () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("matches Node's Buffer base64 encoding for a known vector", () => {
    const bytes = new TextEncoder().encode("hello world");
    const expected = Buffer.from(bytes).toString("base64");
    expect(bytesToBase64(bytes)).toBe(expected);
    expect(base64ToBytes(expected)).toEqual(bytes);
  });

  it("ignores whitespace/newlines when decoding", () => {
    const bytes = new TextEncoder().encode("padded-value!!");
    const b64 = bytesToBase64(bytes);
    const withNewlines = b64.match(/.{1,4}/g)!.join("\n");
    expect(base64ToBytes(withNewlines)).toEqual(bytes);
  });
});
