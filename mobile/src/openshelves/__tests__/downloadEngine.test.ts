import AsyncStorage from "@react-native-async-storage/async-storage";
import { downloadEntry, removeDownload, type Downloader } from "../downloadEngine";
import { getDownload, listDownloads } from "../downloadsStore";
import { FeedSourceError } from "../errors";
import type { FeedEntry } from "../types";

const BASE = "https://ex.org/f.atom";
const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "e1", title: "Book", authors: [], summary: "", coverUrl: null, language: null, categories: [],
  mediaType: "book", rightsText: null, mature: null,
  links: [{ href: "https://ex.org/a.epub", mimeType: "application/epub+zip", rel: "http://opds-spec.org/acquisition" }],
  canonicalUrl: null, ...over,
});

function fakeIO(over: Partial<Downloader> = {}): Downloader & { moved: string[]; removed: string[] } {
  const moved: string[] = []; const removed: string[] = [];
  return {
    dir: "/dl/",
    ensureDir: jest.fn(async () => {}),
    download: jest.fn(async () => ({ bytes: 1234 })),
    move: jest.fn(async (_f, t) => { moved.push(t); }),
    remove: jest.fn(async (p) => { removed.push(p); }),
    moved, removed, ...over,
  } as any;
}

beforeEach(async () => { await AsyncStorage.clear(); });

test("downloads, verifies, records the manifest entry", async () => {
  const io = fakeIO();
  const rec = await downloadEntry(entry(), "s1", BASE, io, () => "T0");
  expect(rec).toMatchObject({ entryId: "e1", sourceId: "s1", bytes: 1234, mimeType: "application/epub+zip", downloadedAt: "T0" });
  expect(await getDownload("e1")).not.toBeNull();
  expect(io.moved.length).toBe(1); // .part → final
});

test("a zero-byte download quarantines: no record, .part removed, throws", async () => {
  const io = fakeIO({ download: jest.fn(async () => ({ bytes: 0 })) as any });
  await expect(downloadEntry(entry(), "s1", BASE, io)).rejects.toThrow();
  expect(await listDownloads()).toEqual([]);
  expect(io.removed.length).toBe(1); // .part cleaned up
});

test("a download error quarantines: no record, throws", async () => {
  const io = fakeIO({ download: jest.fn(async () => { throw new Error("net"); }) as any });
  await expect(downloadEntry(entry(), "s1", BASE, io)).rejects.toThrow();
  expect(await listDownloads()).toEqual([]);
});

test("a non-2xx response quarantines even with a non-empty body", async () => {
  const io = fakeIO({ download: jest.fn(async () => ({ bytes: 5000, status: 404 })) as any });
  await expect(downloadEntry(entry(), "s1", BASE, io)).rejects.toThrow(/HTTP 404/);
  expect(await listDownloads()).toEqual([]);
  expect(io.removed.length).toBe(1); // .part cleaned up
});

test("nothing downloadable (video) throws FeedSourceError", async () => {
  const v = entry({ mediaType: "video", links: [{ href: "https://ex.org/v.mp4", mimeType: "video/mp4", rel: "x" }] });
  await expect(downloadEntry(v, "s1", BASE, fakeIO())).rejects.toBeInstanceOf(FeedSourceError);
});

test("re-downloading the same entry clears the destination and succeeds", async () => {
  const io = fakeIO();
  await downloadEntry(entry(), "s1", BASE, io);       // first
  const rec = await downloadEntry(entry(), "s1", BASE, io); // second (same entryId → same finalPath)
  expect(rec.entryId).toBe("e1");
  // the final path was removed before at least one move (destination cleared)
  expect(io.removed.some((p) => !p.endsWith(".part"))).toBe(true);
});

test("removeDownload deletes the file and the record", async () => {
  const io = fakeIO();
  await downloadEntry(entry(), "s1", BASE, io);
  await removeDownload("e1", io);
  expect(await getDownload("e1")).toBeNull();
  expect(io.removed.length).toBeGreaterThanOrEqual(1);
});
