const mockGetDocument = jest.fn();
const mockReadAsString = jest.fn();

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocument(...args),
}));
jest.mock("expo-file-system", () => ({
  readAsStringAsync: (...args: unknown[]) => mockReadAsString(...args),
}));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { pickBookFileContents, pickTocFileContents } from "@/storage/pickBookFile";

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
