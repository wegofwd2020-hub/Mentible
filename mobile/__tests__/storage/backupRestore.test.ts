import { unzipSync, strFromU8 } from "fflate";
import { restoreBackup, buildBackup } from "@/storage/backupRestore";
import { saveBook } from "@/storage/bookStore";
import { saveEpub } from "@/storage/epubLibrary";

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

it("round-trips: restoreBackup(buildBackup()) writes books + epubs + settings", async () => {
  const { bytes } = await buildBackup();
  (saveBook as jest.Mock).mockClear(); (saveEpub as jest.Mock).mockClear();
  const res = await restoreBackup(bytes);
  expect(res.books).toBe(1);
  expect(res.epubs).toBe(1);
  expect(saveBook).toHaveBeenCalledWith(expect.objectContaining({ id: "b1" }));
  expect(saveEpub).toHaveBeenCalledWith(expect.objectContaining({ bookId: "b1", title: "One" }));
});

it("rejects a non-backup zip with no writes", async () => {
  const { zipSync, strToU8 } = require("fflate");
  const junk = zipSync({ "manifest.json": strToU8(JSON.stringify({ _fmt: "something-else" })) });
  (saveBook as jest.Mock).mockClear();
  await expect(restoreBackup(junk)).rejects.toThrow();
  expect(saveBook).not.toHaveBeenCalled();
});

it("skips a single malformed book entry with a warning, imports the rest", async () => {
  const { zipSync, strToU8 } = require("fflate");
  const z = zipSync({
    "manifest.json": strToU8(JSON.stringify({ _fmt: "mentible-backup", _v: 1 })),
    "books/good.json": strToU8(JSON.stringify({ id: "good", title: "G", toc: { subjects: [] }, content: {} })),
    "books/bad.json": strToU8("{ not json"),
    "epubs/index.json": strToU8("[]"),
  });
  const res = await restoreBackup(z);
  expect(res.books).toBe(1);
  expect(res.warnings.length).toBeGreaterThanOrEqual(1);
});
