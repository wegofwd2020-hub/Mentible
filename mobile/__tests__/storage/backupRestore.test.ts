import { unzipSync, strFromU8 } from "fflate";
import { buildBackup } from "@/storage/backupRestore";

jest.mock("@/storage/bookStore", () => ({
  loadBookIndex: jest.fn(async () => [{ id: "b1", title: "One" }]),
  loadBook: jest.fn(async (id: string) => ({ id, title: "One", toc: { subjects: [] }, content: {} })),
  saveBook: jest.fn(async () => {}),
}));
jest.mock("@/storage/epubLibrary", () => ({
  listEpubs: jest.fn(async () => [{ id: "b1", title: "One", sizeBytes: 3, compiledAt: "x" }]),
  getEpubBytes: jest.fn(async () => new Uint8Array([9,9,9]).buffer),
  saveEpub: jest.fn(async () => ({})),
}));
const store: Record<string,string> = { sbq_shelves: '[{"id":"s1"}]', sbq_byok_key: "SECRET-KEY" };
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => { store[k]=v; }),
  },
}));

it("builds a zip with manifest, books, epubs, settings — and NO api key", async () => {
  const { bytes, counts } = await buildBackup();
  expect(counts).toEqual({ books: 1, epubs: 1 });
  const z = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(z["manifest.json"]));
  expect(manifest._fmt).toBe("mentible-backup");
  expect(manifest.counts).toEqual({ books: 1, epubs: 1 });
  expect(z["books/b1.json"]).toBeTruthy();
  expect(JSON.parse(strFromU8(z["epubs/index.json"]))[0].id).toBe("b1");
  expect(Array.from(z["epubs/b1.epub"])).toEqual([9,9,9]);
  const settings = JSON.parse(strFromU8(z["settings.json"]));
  expect(settings.sbq_shelves).toBe('[{"id":"s1"}]');
  // CRITICAL: the API key must never be in the bundle
  const whole = Object.values(z).map((v) => strFromU8(v)).join("");
  expect(whole).not.toContain("SECRET-KEY");
  expect(settings.sbq_byok_key).toBeUndefined();
});
