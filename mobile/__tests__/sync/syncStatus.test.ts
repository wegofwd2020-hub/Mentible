// syncStatus is a cheap, read-only sibling of syncNow: it answers "is there
// anything to sync" (for a badge/UI) by running the SAME pure planReconcile
// classifier against a listBooks() manifest fetch — no ciphertext fetch, no
// crypto, no shadow/local mutation, no push/pull. Zero-knowledge is
// preserved by construction: it only ever calls syncClient.listBooks
// (metadata only), never getBook/putBook.
jest.mock("@/sync/syncClient");
jest.mock("@/storage/bookStore");
jest.mock("@/sync/lmkStore");

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as syncClient from "@/sync/syncClient";
import * as bookStore from "@/storage/bookStore";
import * as lmkStore from "@/sync/lmkStore";
import { syncStatus } from "@/sync/syncEngine";
import type { BookMeta } from "@/types/book";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mBookStore = bookStore as jest.Mocked<typeof bookStore>;
const mLmkStore = lmkStore as jest.Mocked<typeof lmkStore>;

const TOKEN = "session-token";

function makeMeta(overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    id: "b1",
    title: "t",
    subjectCount: 0,
    unitCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    generatedCount: 0,
    ...overrides,
  } as BookMeta;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mLmkStore.loadLMK.mockResolvedValue(new Uint8Array(32));
  mBookStore.loadBookIndex.mockResolvedValue([]);
  mSyncClient.listBooks.mockResolvedValue([]);
});

it("null token → signed_out, no network calls", async () => {
  const result = await syncStatus(null);
  expect(result.state).toBe("signed_out");
  expect(mSyncClient.listBooks).not.toHaveBeenCalled();
});

it("no LMK cached (locked) → locked, no network calls", async () => {
  mLmkStore.loadLMK.mockResolvedValue(null);

  const result = await syncStatus(TOKEN);

  expect(result.state).toBe("locked");
  expect(mSyncClient.listBooks).not.toHaveBeenCalled();
});

it("nothing to push or pull → up_to_date, toPush/toPull 0", async () => {
  mSyncClient.listBooks.mockResolvedValue([
    { bookId: "b1", clientVersion: "2026-01-01T00:00:00.000Z", deleted: false, updatedAt: "2026-01-01T00:00:00.000Z" },
  ]);
  mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b1", updatedAt: "2026-01-01T00:00:00.000Z" })]);

  const result = await syncStatus(TOKEN);

  expect(result.state).toBe("up_to_date");
  expect(result.toPush).toBe(0);
  expect(result.toPull).toBe(0);
});

it("local-only book + a server-newer book → pending, toPush includes local-only, toPull includes server-newer", async () => {
  mBookStore.loadBookIndex.mockResolvedValue([
    makeMeta({ id: "local-only", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ]);
  mSyncClient.listBooks.mockResolvedValue([
    { bookId: "server-newer", clientVersion: "2026-05-01T00:00:00.000Z", deleted: false, updatedAt: "2026-05-01T00:00:00.000Z" },
  ]);

  const result = await syncStatus(TOKEN);

  expect(result.state).toBe("pending");
  expect(result.toPush).toBe(1); // local-only → toPush
  expect(result.toPull).toBe(1); // server-newer, not local, not in shadow → toPull
});

it("listBooks throws → error, lastSyncedAt still attached", async () => {
  await AsyncStorage.setItem("sbq_sync_last_synced_at", "2026-06-01T00:00:00.000Z");
  mSyncClient.listBooks.mockRejectedValue(new Error("network blip"));

  const result = await syncStatus(TOKEN);

  expect(result.state).toBe("error");
  expect(result.lastSyncedAt).toBe("2026-06-01T00:00:00.000Z");
});

it("never fetches book content or performs crypto — only listBooks (metadata)", async () => {
  mSyncClient.listBooks.mockResolvedValue([
    { bookId: "b1", clientVersion: "2026-05-01T00:00:00.000Z", deleted: false, updatedAt: "2026-05-01T00:00:00.000Z" },
  ]);

  await syncStatus(TOKEN);

  expect(mSyncClient.getBook).not.toHaveBeenCalled();
  expect(mSyncClient.putBook).not.toHaveBeenCalled();
  expect(mSyncClient.deleteBook).not.toHaveBeenCalled();
});
