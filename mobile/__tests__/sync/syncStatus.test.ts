// syncStatus is a cheap, read-only sibling of syncNow: it answers "is there
// anything to sync" (for a badge/UI) by running the SAME pure planReconcile
// classifier against a listBooks() manifest fetch — no ciphertext fetch, no
// crypto, no shadow/local mutation, no push/pull. Zero-knowledge is
// preserved by construction: it only ever calls syncClient.listBooks
// (metadata only), never getBook/putBook.
jest.mock("@/sync/syncClient");
jest.mock("@/storage/bookStore");
jest.mock("@/sync/lmkStore");
// This file is exclusively about the book-manifest pending count — the epub/
// shelves pending-count additions get their own assertions in
// syncEpubs.test.ts/syncShelves.test.ts. Mocked here to an empty/no-op
// default so every existing book-only assertion below stays unchanged.
jest.mock("@/storage/epubLibrary");
jest.mock("@/storage/shelfStore");

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as syncClient from "@/sync/syncClient";
import * as bookStore from "@/storage/bookStore";
import * as lmkStore from "@/sync/lmkStore";
import * as epubLibrary from "@/storage/epubLibrary";
import * as shelfStore from "@/storage/shelfStore";
import { syncStatus } from "@/sync/syncEngine";
import type { BookMeta } from "@/types/book";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mBookStore = bookStore as jest.Mocked<typeof bookStore>;
const mLmkStore = lmkStore as jest.Mocked<typeof lmkStore>;
const mEpubLibrary = epubLibrary as jest.Mocked<typeof epubLibrary>;
const mShelfStore = shelfStore as jest.Mocked<typeof shelfStore>;

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

  // Empty/no-op epub + shelves world by default — see the jest.mock note above.
  mEpubLibrary.listEpubs.mockResolvedValue([]);
  mShelfStore.exportShelvesDoc.mockResolvedValue({
    shelves: [],
    assignments: {},
    updatedAt: "1970-01-01T00:00:00.000Z",
  });
  mSyncClient.listEpubs.mockResolvedValue([]);
  mSyncClient.getShelves.mockResolvedValue(null);
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

it("all books live-equal (nonempty shadow) → up_to_date, counts 0 — equalKeep must NOT count as pending", async () => {
  await AsyncStorage.setItem("sbq_sync_shadow", JSON.stringify(["b1"]));
  mSyncClient.listBooks.mockResolvedValue([
    { bookId: "b1", clientVersion: "2026-01-01T00:00:00.000Z", deleted: false, updatedAt: "2026-01-01T00:00:00.000Z" },
  ]);
  mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b1", updatedAt: "2026-01-01T00:00:00.000Z" })]);

  const result = await syncStatus(TOKEN);

  expect(result.state).toBe("up_to_date");
  expect(result.toPush).toBe(0);
  expect(result.toPull).toBe(0);
});

it("toPushDelete counts into toPush, toDeleteLocal counts into toPull", async () => {
  // "gone" (in shadow, not local, server still live) → toPushDelete.
  // "tomb" (local, server tombstone newer) → toDeleteLocal.
  await AsyncStorage.setItem("sbq_sync_shadow", JSON.stringify(["gone"]));
  mBookStore.loadBookIndex.mockResolvedValue([
    makeMeta({ id: "tomb", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ]);
  mSyncClient.listBooks.mockResolvedValue([
    { bookId: "gone", clientVersion: "2026-01-01T00:00:00.000Z", deleted: false, updatedAt: "2026-01-01T00:00:00.000Z" },
    { bookId: "tomb", clientVersion: "2026-01-01T00:00:00.000Z", deleted: true, updatedAt: "2026-03-01T00:00:00.000Z" },
  ]);

  const result = await syncStatus(TOKEN);

  expect(result.state).toBe("pending");
  expect(result.toPush).toBe(1); // toPushDelete("gone")
  expect(result.toPull).toBe(1); // toDeleteLocal("tomb")
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

describe("syncStatus — epubs + shelves pending counts (T5)", () => {
  it("a local-only epub counts as toPush; a server-newer epub counts as toPull", async () => {
    mEpubLibrary.listEpubs.mockResolvedValue([
      { id: "local-only-epub", title: "t", sizeBytes: 1, compiledAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "server-newer-epub", clientVersion: "2026-05-01T00:00:00.000Z", deleted: false, updatedAt: "2026-05-01T00:00:00.000Z", byteSize: 1 },
    ]);

    const result = await syncStatus(TOKEN);

    expect(result.state).toBe("pending");
    expect(result.toPush).toBe(1);
    expect(result.toPull).toBe(1);
  });

  it("shelves: local doc newer than server → +1 toPush; server newer → +1 toPull; equal → 0", async () => {
    mShelfStore.exportShelvesDoc.mockResolvedValue({
      shelves: [{ id: "s1", name: "S", createdAt: "2026-01-01T00:00:00.000Z", order: 0 }],
      assignments: {},
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: new Uint8Array(1), nonce: new Uint8Array(1), wrappedDk: new Uint8Array(1), dkNonce: new Uint8Array(1),
      clientVersion: "2026-01-01T00:00:00.000Z", // older than local
    });

    const pushResult = await syncStatus(TOKEN);
    expect(pushResult.toPush).toBe(1);
    expect(pushResult.toPull).toBe(0);

    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: new Uint8Array(1), nonce: new Uint8Array(1), wrappedDk: new Uint8Array(1), dkNonce: new Uint8Array(1),
      clientVersion: "2099-01-01T00:00:00.000Z", // newer than local
    });
    const pullResult = await syncStatus(TOKEN);
    expect(pullResult.toPush).toBe(0);
    expect(pullResult.toPull).toBe(1);

    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: new Uint8Array(1), nonce: new Uint8Array(1), wrappedDk: new Uint8Array(1), dkNonce: new Uint8Array(1),
      clientVersion: "2026-06-01T00:00:00.000Z", // equal to local
    });
    const equalResult = await syncStatus(TOKEN);
    expect(equalResult.toPush).toBe(0);
    expect(equalResult.toPull).toBe(0);
  });

  it("DEVIATION: server has no shelves doc AND the local doc is genuinely empty → 0 pending (not +1)", async () => {
    mShelfStore.exportShelvesDoc.mockResolvedValue({
      shelves: [],
      assignments: {},
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    mSyncClient.getShelves.mockResolvedValue(null);

    const result = await syncStatus(TOKEN);

    expect(result.state).toBe("up_to_date");
    expect(result.toPush).toBe(0);
  });

  it("never fetches epub bytes or shelves content-decrypts — only listEpubs/getShelves metadata", async () => {
    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e1", clientVersion: "2026-05-01T00:00:00.000Z", deleted: false, updatedAt: "2026-05-01T00:00:00.000Z", byteSize: 1 },
    ]);

    await syncStatus(TOKEN);

    expect(mSyncClient.getEpub).not.toHaveBeenCalled();
    expect(mSyncClient.putEpub).not.toHaveBeenCalled();
    expect(mSyncClient.deleteEpub).not.toHaveBeenCalled();
    expect(mSyncClient.putShelves).not.toHaveBeenCalled();
  });
});
