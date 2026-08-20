// syncEngine.ts is the client sync engine: envelope-encrypt/decrypt +
// syncNow's LWW reconciliation. Everything it talks to is mocked here
// (syncClient, envelope, bookStore, lmkStore) so these tests exercise only
// the engine's own logic — the GLOBAL CONSTRAINT under test is that a
// `syncNow` push NEVER puts plaintext book title/content on the wire; only
// ciphertext (+ nonces/wrapped keys/client_version) crosses `putBook`.

jest.mock("@/sync/syncClient");
jest.mock("@/crypto/envelope");
jest.mock("@/storage/bookStore");
jest.mock("@/sync/lmkStore");

import * as syncClient from "@/sync/syncClient";
import * as envelope from "@/crypto/envelope";
import * as bookStore from "@/storage/bookStore";
import * as lmkStore from "@/sync/lmkStore";
import { ApiError } from "@/api/client";
import {
  enableSync,
  unlockOnDevice,
  syncNow,
  SyncLockedError,
  SyncKeysetExistsError,
} from "@/sync/syncEngine";
import type { Book, BookMeta } from "@/types/book";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mEnvelope = envelope as jest.Mocked<typeof envelope>;
const mBookStore = bookStore as jest.Mocked<typeof bookStore>;
const mLmkStore = lmkStore as jest.Mocked<typeof lmkStore>;

const bytes = (n: number, seed = 1) => {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * seed + 11) % 256;
  return u;
};

const LMK = bytes(32, 2);
const TOKEN = "session-token";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "b1",
    title: "A DISTINCTIVE TITLE THAT MUST NEVER LEAVE THE DEVICE",
    toc: { subjects: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Book;
}

function makeMeta(overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    id: "b1",
    title: "A DISTINCTIVE TITLE THAT MUST NEVER LEAVE THE DEVICE",
    subjectCount: 0,
    unitCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    generatedCount: 0,
    ...overrides,
  } as BookMeta;
}

beforeEach(() => {
  jest.clearAllMocks();

  // Deterministic-enough envelope stand-ins. seal/open are NOT reciprocal
  // real crypto here — they're per-test-controlled mocks — except in the
  // "decrypt throws" test where `open`/`decryptBook` are made to throw.
  mEnvelope.generateKey.mockReturnValue(bytes(32, 5));
  mEnvelope.randomSalt.mockReturnValue(bytes(16, 6));
  mEnvelope.generateRecoveryKey.mockReturnValue("fake-recovery-key");
  mEnvelope.deriveKEK.mockReturnValue(bytes(32, 7));
  mEnvelope.seal.mockImplementation((_key: Uint8Array, data: Uint8Array) => ({
    nonce: bytes(12, 8),
    ct: data, // pass-through so we can assert on shape without a real cipher
  }));
  mEnvelope.open.mockImplementation((_key: Uint8Array, _nonce: Uint8Array, ct: Uint8Array) => ct);
  mEnvelope.encryptBook.mockImplementation((json: string) => ({
    nonce: bytes(12, 9),
    ct: new TextEncoder().encode(json), // "ciphertext" — but content-derived so we can grep it for the plaintext check
  }));
  mEnvelope.decryptBook.mockImplementation((_n: Uint8Array, ct: Uint8Array) => new TextDecoder().decode(ct));

  mLmkStore.loadLMK.mockResolvedValue(LMK);
  mLmkStore.saveLMK.mockResolvedValue(undefined);
  mLmkStore.clearLMK.mockResolvedValue(undefined);
});

describe("enableSync", () => {
  it("generates a recovery key, uploads a wrapped keyset, caches the LMK, and returns the recovery key", async () => {
    mSyncClient.putKeyset.mockResolvedValue({
      wrappedLmk: bytes(1), lmkNonce: bytes(1), kekSalt: bytes(1),
    });

    const rk = await enableSync(TOKEN);

    expect(rk).toBe("fake-recovery-key");
    expect(mSyncClient.putKeyset).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ wrappedLmk: expect.any(Uint8Array) }),
    );
    expect(mLmkStore.saveLMK).toHaveBeenCalled();
  });

  it("does NOT overwrite an existing keyset — a 409 surfaces as SyncKeysetExistsError, LMK not cached", async () => {
    mSyncClient.putKeyset.mockRejectedValue(new ApiError(409, "conflict"));

    await expect(enableSync(TOKEN)).rejects.toBeInstanceOf(SyncKeysetExistsError);
    expect(mLmkStore.saveLMK).not.toHaveBeenCalled();
  });
});

describe("unlockOnDevice", () => {
  it("unwraps the LMK with the correct recovery key and caches it", async () => {
    mSyncClient.getKeyset.mockResolvedValue({
      wrappedLmk: LMK, lmkNonce: bytes(12), kekSalt: bytes(16),
    });

    await unlockOnDevice(TOKEN, "correct-recovery-key");

    expect(mLmkStore.saveLMK).toHaveBeenCalledWith(LMK);
  });

  it("wrong recovery key → open() throws → surfaced as an error, LMK NOT cached", async () => {
    mSyncClient.getKeyset.mockResolvedValue({
      wrappedLmk: LMK, lmkNonce: bytes(12), kekSalt: bytes(16),
    });
    mEnvelope.open.mockImplementation(() => {
      throw new Error("cipher: message authentication failed");
    });

    await expect(unlockOnDevice(TOKEN, "wrong-recovery-key")).rejects.toThrow(
      /authentication failed/,
    );
    expect(mLmkStore.saveLMK).not.toHaveBeenCalled();
  });
});

describe("syncNow — locked device", () => {
  it("no LMK cached → SyncLockedError, no network calls at all (no plaintext can leave)", async () => {
    mLmkStore.loadLMK.mockResolvedValue(null);

    await expect(syncNow(TOKEN)).rejects.toBeInstanceOf(SyncLockedError);
    expect(mSyncClient.listBooks).not.toHaveBeenCalled();
    expect(mSyncClient.putBook).not.toHaveBeenCalled();
  });
});

describe("syncNow — reconciliation", () => {
  it("pushes a local-only/local-newer book: putBook called, and the wire body carries NO plaintext title/content", async () => {
    const book = makeBook({ id: "b1", updatedAt: "2026-03-01T00:00:00.000Z" });
    mSyncClient.listBooks.mockResolvedValue([]); // nothing on the server yet
    mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b1", updatedAt: book.updatedAt })]);
    mBookStore.loadBook.mockResolvedValue(book);
    mSyncClient.putBook.mockResolvedValue({
      bookId: "b1", clientVersion: book.updatedAt, deleted: false, updatedAt: book.updatedAt,
      ciphertext: bytes(1), nonce: bytes(1), wrappedDk: bytes(1), dkNonce: bytes(1),
    });

    const result = await syncNow(TOKEN);

    expect(result).toEqual({ pushed: 1, pulled: 0, deleted: 0, failed: [] });
    expect(mSyncClient.putBook).toHaveBeenCalledTimes(1);
    const [, id, blob] = mSyncClient.putBook.mock.calls[0];
    expect(id).toBe("b1");

    // The GLOBAL CONSTRAINT under test: the entire serialized PUT body must
    // never contain the book's plaintext title or content — only ciphertext,
    // nonces, wrapped key material, and the client_version string.
    const serializedBody = JSON.stringify(blob, (_k, v) =>
      v instanceof Uint8Array ? Array.from(v).join(",") : v,
    );
    expect(serializedBody).not.toContain("DISTINCTIVE TITLE");
    expect(serializedBody).not.toContain(book.title);
  });

  it("pulls a server-newer book: getBook + decrypt + saveBook", async () => {
    const remoteBook = makeBook({ id: "b2", updatedAt: "2026-03-05T00:00:00.000Z" });
    const remoteJson = JSON.stringify(remoteBook);
    mSyncClient.listBooks.mockResolvedValue([
      { bookId: "b2", clientVersion: "2026-03-05T00:00:00.000Z", deleted: false, updatedAt: "2026-03-05T00:00:00.000Z" },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b2", updatedAt: "2026-03-01T00:00:00.000Z" })]);
    mSyncClient.getBook.mockResolvedValue({
      bookId: "b2", clientVersion: "2026-03-05T00:00:00.000Z", deleted: false, updatedAt: "2026-03-05T00:00:00.000Z",
      ciphertext: new TextEncoder().encode(remoteJson), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
    });

    const result = await syncNow(TOKEN);

    expect(result).toEqual({ pushed: 0, pulled: 1, deleted: 0, failed: [] });
    expect(mSyncClient.getBook).toHaveBeenCalledWith(TOKEN, "b2");
    expect(mBookStore.saveBook).toHaveBeenCalledWith(remoteBook);
    expect(mSyncClient.putBook).not.toHaveBeenCalled();
  });

  it("pulls a server-only book not present locally at all", async () => {
    const remoteBook = makeBook({ id: "b3", updatedAt: "2026-04-01T00:00:00.000Z" });
    mSyncClient.listBooks.mockResolvedValue([
      { bookId: "b3", clientVersion: remoteBook.updatedAt, deleted: false, updatedAt: remoteBook.updatedAt },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([]);
    mSyncClient.getBook.mockResolvedValue({
      bookId: "b3", clientVersion: remoteBook.updatedAt, deleted: false, updatedAt: remoteBook.updatedAt,
      ciphertext: new TextEncoder().encode(JSON.stringify(remoteBook)), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
    });

    const result = await syncNow(TOKEN);
    expect(result.pulled).toBe(1);
    expect(mBookStore.saveBook).toHaveBeenCalledWith(remoteBook);
  });

  it("deletes locally on a newer server tombstone", async () => {
    mSyncClient.listBooks.mockResolvedValue([
      { bookId: "b4", clientVersion: "2026-05-01T00:00:00.000Z", deleted: true, updatedAt: "2026-05-01T00:00:00.000Z" },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b4", updatedAt: "2026-01-01T00:00:00.000Z" })]);

    const result = await syncNow(TOKEN);

    expect(result).toEqual({ pushed: 0, pulled: 0, deleted: 1, failed: [] });
    expect(mBookStore.deleteBook).toHaveBeenCalledWith("b4");
    expect(mSyncClient.getBook).not.toHaveBeenCalled();
  });

  it("skips a book whose local updatedAt equals the server client_version", async () => {
    mSyncClient.listBooks.mockResolvedValue([
      { bookId: "b5", clientVersion: "2026-01-01T00:00:00.000Z", deleted: false, updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b5", updatedAt: "2026-01-01T00:00:00.000Z" })]);

    const result = await syncNow(TOKEN);

    expect(result).toEqual({ pushed: 0, pulled: 0, deleted: 0, failed: [] });
    expect(mSyncClient.putBook).not.toHaveBeenCalled();
    expect(mSyncClient.getBook).not.toHaveBeenCalled();
    expect(mBookStore.deleteBook).not.toHaveBeenCalled();
  });

  it("a single book's decrypt failure is caught and reported in `failed` — other books still sync", async () => {
    const goodBook = makeBook({ id: "good", updatedAt: "2026-06-01T00:00:00.000Z" });
    const badMeta = { bookId: "bad", clientVersion: "2026-06-01T00:00:00.000Z", deleted: false, updatedAt: "2026-06-01T00:00:00.000Z" };
    const goodMeta = { bookId: "good", clientVersion: "2026-06-01T00:00:00.000Z", deleted: false, updatedAt: "2026-06-01T00:00:00.000Z" };

    mSyncClient.listBooks.mockResolvedValue([badMeta, goodMeta]);
    mBookStore.loadBookIndex.mockResolvedValue([]); // neither exists locally → both pull

    mSyncClient.getBook.mockImplementation(async (_t, id) => {
      if (id === "bad") {
        return {
          bookId: "bad", clientVersion: badMeta.clientVersion, deleted: false, updatedAt: badMeta.updatedAt,
          ciphertext: bytes(8), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
        };
      }
      return {
        bookId: "good", clientVersion: goodMeta.clientVersion, deleted: false, updatedAt: goodMeta.updatedAt,
        ciphertext: new TextEncoder().encode(JSON.stringify(goodBook)), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
      };
    });

    // decryptBook throws only for the "bad" book's ciphertext.
    mEnvelope.decryptBook.mockImplementation((_n: Uint8Array, ct: Uint8Array) => {
      const text = new TextDecoder().decode(ct);
      if (!text.startsWith("{")) throw new Error("bad ciphertext");
      return text;
    });

    const result = await syncNow(TOKEN);

    expect(result.failed).toEqual(["bad"]);
    expect(result.pulled).toBe(1);
    expect(mBookStore.saveBook).toHaveBeenCalledWith(goodBook);
    expect(mBookStore.saveBook).not.toHaveBeenCalledWith(expect.objectContaining({ id: "bad" }));
  });

  it("across a full run, no putBook body ever carries a plaintext book title/content substring", async () => {
    const book1 = makeBook({ id: "p1", title: "SECRET TITLE ONE", updatedAt: "2026-07-01T00:00:00.000Z" });
    const book2 = makeBook({ id: "p2", title: "SECRET TITLE TWO", updatedAt: "2026-07-01T00:00:00.000Z" });
    mSyncClient.listBooks.mockResolvedValue([]);
    mBookStore.loadBookIndex.mockResolvedValue([
      makeMeta({ id: "p1", title: book1.title, updatedAt: book1.updatedAt }),
      makeMeta({ id: "p2", title: book2.title, updatedAt: book2.updatedAt }),
    ]);
    mBookStore.loadBook.mockImplementation(async (id: string) => (id === "p1" ? book1 : book2));
    mSyncClient.putBook.mockImplementation(async (_t, id, blob) => ({
      bookId: id, deleted: false, updatedAt: blob.clientVersion,
      ...blob,
    }));

    await syncNow(TOKEN);

    expect(mSyncClient.putBook).toHaveBeenCalledTimes(2);
    for (const call of mSyncClient.putBook.mock.calls) {
      const [, , blob] = call;
      const serialized = JSON.stringify(blob, (_k, v) =>
        v instanceof Uint8Array ? Array.from(v).join(",") : v,
      );
      expect(serialized).not.toMatch(/SECRET TITLE (ONE|TWO)/);
    }
  });
});
