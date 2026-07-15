const mockGetDocument = jest.fn();
const mockReadAsString = jest.fn();

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocument(...args),
}));
jest.mock("expo-file-system", () => ({
  readAsStringAsync: (...args: unknown[]) => mockReadAsString(...args),
  EncodingType: { Base64: "base64" },
}));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  fromBase64,
  pickBookFileContents,
  pickBookFileOrBundle,
  pickEpubFile,
  pickTocFileContents,
} from "@/storage/pickBookFile";

describe("pickBookFileContents", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockReadAsString.mockReset();
  });

  it("returns null when the picker is cancelled", async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickBookFileContents()).toBeNull();
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it("returns null when no asset comes back", async () => {
    mockGetDocument.mockResolvedValue({ canceled: false, assets: [] });
    expect(await pickBookFileContents()).toBeNull();
  });

  it("reads the picked file's contents on native", async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/book.json", name: "book.json" }],
    });
    mockReadAsString.mockResolvedValue('{"title":"x"}');
    expect(await pickBookFileContents()).toBe('{"title":"x"}');
    expect(mockReadAsString).toHaveBeenCalledWith("file:///tmp/book.json");
  });
});

describe("pickTocFileContents", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockReadAsString.mockReset();
  });

  it("returns null when the picker is cancelled", async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickTocFileContents()).toBeNull();
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it("reads a picked markdown file's contents", async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/toc.md", name: "toc.md" }],
    });
    mockReadAsString.mockResolvedValue("# Physics\n- Kinematics");
    expect(await pickTocFileContents()).toBe("# Physics\n- Kinematics");
    expect(mockReadAsString).toHaveBeenCalledWith("file:///tmp/toc.md");
  });

  it("allows markdown/text MIME types so .md files are selectable", async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    await pickTocFileContents();
    const passedType = mockGetDocument.mock.calls[0][0].type;
    expect(passedType).toEqual(expect.arrayContaining(["text/markdown", "text/plain"]));
  });
});

describe("fromBase64", () => {
  it("round-trips binary incl. the EPUB 'PK' header and high bytes", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 255, 0, 128, 1, 254, 7, 8, 9]);
    const out = new Uint8Array(fromBase64(Buffer.from(bytes).toString("base64")));
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it("handles lengths not divisible by 3 (padding cases)", () => {
    for (const n of [0, 1, 2, 4, 5, 7, 100]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37) & 0xff));
      const out = new Uint8Array(fromBase64(Buffer.from(bytes).toString("base64")));
      expect(Array.from(out)).toEqual(Array.from(bytes));
    }
  });
});

describe("pickEpubFile", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockReadAsString.mockReset();
  });

  it("returns null when cancelled", async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickEpubFile()).toBeNull();
  });

  it("reads the picked epub as bytes on native", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 8, 7, 6]);
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/b.epub", name: "b.epub" }],
    });
    mockReadAsString.mockResolvedValue(Buffer.from(bytes).toString("base64"));
    const res = await pickEpubFile();
    expect(res?.name).toBe("b.epub");
    expect(Array.from(new Uint8Array(res!.bytes))).toEqual(Array.from(bytes));
    expect(mockReadAsString).toHaveBeenCalledWith("file:///tmp/b.epub", { encoding: "base64" });
  });
});

// pickBookFileOrBundle is the single "Import a book" entry point (import.tsx):
// it picks either a plain .book.json (text) or a .book.zip bundle (bytes) and
// tags which kind it was via a discriminated union — used by every file import.
describe("pickBookFileOrBundle", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockReadAsString.mockReset();
  });

  it("returns null when the picker is cancelled", async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickBookFileOrBundle()).toBeNull();
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it("returns the zip/bytes branch for a picked .zip file", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 8, 7, 6]);
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/book.zip", name: "book.zip", mimeType: "application/zip" }],
    });
    mockReadAsString.mockResolvedValue(Buffer.from(bytes).toString("base64"));

    const res = await pickBookFileOrBundle();
    expect(res?.kind).toBe("zip");
    if (res?.kind === "zip") {
      expect(Array.from(new Uint8Array(res.bytes))).toEqual(Array.from(bytes));
    }
    expect(mockReadAsString).toHaveBeenCalledWith("file:///tmp/book.zip", { encoding: "base64" });
  });

  it("returns the zip/bytes branch when the mimeType is application/zip even without a .zip name", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/upload", name: "upload", mimeType: "application/zip" }],
    });
    mockReadAsString.mockResolvedValue(Buffer.from(bytes).toString("base64"));

    const res = await pickBookFileOrBundle();
    expect(res?.kind).toBe("zip");
  });

  it("returns the json/text branch for a picked .book.json file", async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/book.json", name: "book.json", mimeType: "application/json" }],
    });
    mockReadAsString.mockResolvedValue('{"title":"x"}');

    const res = await pickBookFileOrBundle();
    expect(res).toEqual({ kind: "json", text: '{"title":"x"}' });
    expect(mockReadAsString).toHaveBeenCalledWith("file:///tmp/book.json");
  });
});
