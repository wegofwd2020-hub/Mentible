// syncEngine.ts is the client sync engine: envelope-encrypt/decrypt +
// syncNow's LWW reconciliation, disambiguated by a persisted "sync shadow"
// (the set of book ids this device believes are currently synced) so a local
// delete can be told apart from "never synced". Everything it talks to is
// mocked here (syncClient, envelope, bookStore, lmkStore) EXCEPT
// @react-native-async-storage/async-storage, which stays the real in-memory
// jest mock (wired globally in jest.setup.js) — the shadow/last-synced state
// syncEngine persists there is exactly what these tests need to exercise
// (including that it survives across separate `syncNow` calls). The GLOBAL
// CONSTRAINT under test is that a `syncNow` push NEVER puts plaintext book
// title/content on the wire; only ciphertext (+ nonces/wrapped keys/
// client_version) crosses `putBook`.

jest.mock("@/sync/syncClient");
jest.mock("@/crypto/envelope");
jest.mock("@/storage/bookStore");
jest.mock("@/sync/lmkStore");

import AsyncStorage from "@react-native-async-storage/async-storage";
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

// A REAL (if trivial) transform — every byte flipped — so a test that
// forgets to encrypt (i.e. forwards the plaintext straight through) produces
// bytes that differ from this and DOES fail. A pass-through mock here would
// make the "no plaintext leaves" tests below tautological, which is exactly
// the bug this round fixes.
function xorObfuscate(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ 0xff;
  return out;
}

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

beforeEach(async () => {
  jest.clearAllMocks();
  // syncEngine persists the sync shadow + last-synced timestamp to the REAL
  // AsyncStorage mock (not jest.mock'd away in this file) — clear it between
  // tests so one test's shadow state can't leak into the next. The one test
  // that deliberately checks cross-call persistence does so entirely within
  // its own `it()`, after this clear has already run once.
  await AsyncStorage.clear();

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
    ct: xorObfuscate(new TextEncoder().encode(json)), // NOT plaintext — see xorObfuscate
  }));
  mEnvelope.decryptBook.mockImplementation((_n: Uint8Array, ct: Uint8Array) =>
    new TextDecoder().decode(xorObfuscate(ct)), // inverse of encryptBook's XOR above
  );

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
  it("pushes a local-only/local-newer book: putBook called, and the ciphertext is genuinely NOT the plaintext", async () => {
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

    // The GLOBAL CONSTRAINT under test, made REAL (not a tautology): the
    // ciphertext bytes must differ byte-for-byte from the plaintext book
    // JSON, and decoding them as UTF-8 must not surface the book's title. A
    // regression that ships `JSON.stringify(book)` straight through as
    // "ciphertext" would fail both assertions below.
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(book));
    expect(blob.ciphertext).not.toEqual(plaintextBytes);
    const decodedAsUtf8 = new TextDecoder().decode(blob.ciphertext);
    expect(decodedAsUtf8).not.toContain(book.title);
    expect(decodedAsUtf8).not.toContain("DISTINCTIVE TITLE");
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
      ciphertext: xorObfuscate(new TextEncoder().encode(remoteJson)), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
    });

    const result = await syncNow(TOKEN);

    expect(result).toEqual({ pushed: 0, pulled: 1, deleted: 0, failed: [] });
    expect(mSyncClient.getBook).toHaveBeenCalledWith(TOKEN, "b2");
    expect(mBookStore.saveBook).toHaveBeenCalledWith(remoteBook);
    expect(mSyncClient.putBook).not.toHaveBeenCalled();
  });

  it("pulls a server-only book not present locally and not in the shadow (genuinely new from a peer)", async () => {
    const remoteBook = makeBook({ id: "b3", updatedAt: "2026-04-01T00:00:00.000Z" });
    mSyncClient.listBooks.mockResolvedValue([
      { bookId: "b3", clientVersion: remoteBook.updatedAt, deleted: false, updatedAt: remoteBook.updatedAt },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([]);
    mSyncClient.getBook.mockResolvedValue({
      bookId: "b3", clientVersion: remoteBook.updatedAt, deleted: false, updatedAt: remoteBook.updatedAt,
      ciphertext: xorObfuscate(new TextEncoder().encode(JSON.stringify(remoteBook))), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
    });

    const result = await syncNow(TOKEN);
    expect(result.pulled).toBe(1);
    expect(mBookStore.saveBook).toHaveBeenCalledWith(remoteBook);
    expect(mSyncClient.deleteBook).not.toHaveBeenCalled();
  });

  it("deletes locally on a newer server tombstone (compared via server.updatedAt, not client_version)", async () => {
    mSyncClient.listBooks.mockResolvedValue([
      { bookId: "b4", clientVersion: "2026-05-01T00:00:00.000Z", deleted: true, updatedAt: "2026-05-01T00:00:00.000Z" },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([makeMeta({ id: "b4", updatedAt: "2026-01-01T00:00:00.000Z" })]);

    const result = await syncNow(TOKEN);

    expect(result).toEqual({ pushed: 0, pulled: 0, deleted: 1, failed: [] });
    expect(mBookStore.deleteBook).toHaveBeenCalledWith("b4");
    expect(mSyncClient.getBook).not.toHaveBeenCalled();
  });

  it("FIX 2: a steady-state tombstone (local.updatedAt === server.client_version, but server.updatedAt is newer) still deletes locally", async () => {
    // client_version is never bumped by DELETE (T2), so it still equals what
    // the last PUT set — a naive "compare against client_version" LWW would
    // read this as cmp===0 ("equal, skip") and miss the tombstone forever.
    // The real tombstone recency lives in server.updated_at, which IS newer.
    mSyncClient.listBooks.mockResolvedValue([
      {
        bookId: "b6",
        clientVersion: "2026-08-01T00:00:00.000Z", // unchanged by the delete
        deleted: true,
        updatedAt: "2026-08-02T00:00:00.000Z", // the real tombstone timestamp
      },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([
      makeMeta({ id: "b6", updatedAt: "2026-08-01T00:00:00.000Z" }), // equals client_version exactly
    ]);

    const result = await syncNow(TOKEN);

    expect(mBookStore.deleteBook).toHaveBeenCalledWith("b6");
    expect(result.deleted).toBe(1);
    expect(mSyncClient.getBook).not.toHaveBeenCalled();
  });

  it("FIX A: tombstone compare is format-agnostic — a pydantic microsecond/+00:00 server.updatedAt vs a JS millisecond/Z local.updatedAt in the same second still deletes locally", async () => {
    // local.updatedAt is JS `toISOString()` shape (ms precision, `Z`).
    // server.updatedAt is a real pydantic-serialized Postgres timestamptz
    // (µs precision, `+00:00` offset) landing in the SAME millisecond. A
    // lexical string compare gets this backwards — `"...123Z"` sorts AFTER
    // `"...123456+00:00"` because `Z` (0x5A) > `4` (0x34) — and would wrongly
    // treat the local copy as newer, reviving a book that should stay
    // deleted. The epoch-based compare must get this right.
    mSyncClient.listBooks.mockResolvedValue([
      {
        bookId: "b7",
        clientVersion: "2026-08-20T19:15:04.000Z",
        deleted: true,
        updatedAt: "2026-08-20T19:15:04.123456+00:00",
      },
    ]);
    mBookStore.loadBookIndex.mockResolvedValue([
      makeMeta({ id: "b7", updatedAt: "2026-08-20T19:15:04.123Z" }),
    ]);

    const result = await syncNow(TOKEN);

    expect(mBookStore.deleteBook).toHaveBeenCalledWith("b7");
    expect(result.deleted).toBe(1);
    expect(mSyncClient.putBook).not.toHaveBeenCalled();
    expect(mSyncClient.getBook).not.toHaveBeenCalled();
  });

  it("skips a book whose local updatedAt equals the server client_version (live, not a tombstone)", async () => {
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
        ciphertext: xorObfuscate(new TextEncoder().encode(JSON.stringify(goodBook))), nonce: bytes(12), wrappedDk: bytes(32), dkNonce: bytes(12),
      };
    });

    // decryptBook throws only for the "bad" book's ciphertext (its unXOR'd
    // bytes never start with "{").
    mEnvelope.decryptBook.mockImplementation((_n: Uint8Array, ct: Uint8Array) => {
      const text = new TextDecoder().decode(xorObfuscate(ct));
      if (!text.startsWith("{")) throw new Error("bad ciphertext");
      return text;
    });

    const result = await syncNow(TOKEN);

    expect(result.failed).toEqual(["bad"]);
    expect(result.pulled).toBe(1);
    expect(mBookStore.saveBook).toHaveBeenCalledWith(goodBook);
    expect(mBookStore.saveBook).not.toHaveBeenCalledWith(expect.objectContaining({ id: "bad" }));
  });

  it("across a full run, no putBook ciphertext ever decodes to a plaintext book title/content substring", async () => {
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
    const booksById: Record<string, Book> = { p1: book1, p2: book2 };
    for (const [, id, blob] of mSyncClient.putBook.mock.calls) {
      const plaintextBytes = new TextEncoder().encode(JSON.stringify(booksById[id]));
      expect(blob.ciphertext).not.toEqual(plaintextBytes);
      const decoded = new TextDecoder().decode(blob.ciphertext);
      expect(decoded).not.toMatch(/SECRET TITLE (ONE|TWO)/);
    }
  });
});

describe("syncNow — sync shadow (FIX 1: local delete resurrection / missed peer tombstone)", () => {
  it("a book synced then deleted locally: the SECOND syncNow pushes the tombstone (deleteBook) and does NOT re-pull it — and the shadow persisted across the two calls", async () => {
    const book = makeBook({ id: "b1", updatedAt: "2026-09-01T00:00:00.000Z" });

    // --- Run 1: book exists only locally → push, and the shadow should now
    // remember "b1" as synced.
    mSyncClient.listBooks.mockResolvedValueOnce([]);
    mBookStore.loadBookIndex.mockResolvedValueOnce([makeMeta({ id: "b1", updatedAt: book.updatedAt })]);
    mBookStore.loadBook.mockResolvedValueOnce(book);
    mSyncClient.putBook.mockResolvedValueOnce({
      bookId: "b1", clientVersion: book.updatedAt, deleted: false, updatedAt: book.updatedAt,
      ciphertext: bytes(1), nonce: bytes(1), wrappedDk: bytes(1), dkNonce: bytes(1),
    });

    const run1 = await syncNow(TOKEN);
    expect(run1.pushed).toBe(1);

    // The shadow is real persisted state (AsyncStorage), not a mock return
    // value — assert it directly to prove cross-call persistence.
    const shadowRaw = await AsyncStorage.getItem("sbq_sync_shadow");
    expect(JSON.parse(shadowRaw ?? "[]")).toContain("b1");

    // --- Run 2: the user deleted "b1" locally (no longer in the local
    // index); the server still has it as live (simulating what run 1 just
    // pushed). Without the shadow, this looks identical to "never had it,
    // pull it" — which would resurrect the delete.
    mSyncClient.listBooks.mockResolvedValueOnce([
      { bookId: "b1", clientVersion: book.updatedAt, deleted: false, updatedAt: book.updatedAt },
    ]);
    mBookStore.loadBookIndex.mockResolvedValueOnce([]); // deleted locally

    const run2 = await syncNow(TOKEN);

    expect(mSyncClient.deleteBook).toHaveBeenCalledWith(TOKEN, "b1");
    expect(mSyncClient.getBook).not.toHaveBeenCalled(); // must NOT re-pull the "deleted" book
    expect(mBookStore.saveBook).not.toHaveBeenCalled();
    expect(run2.deleted).toBe(1);
    expect(run2.pulled).toBe(0);

    // The shadow should have forgotten "b1" now that both sides agree it's gone.
    const shadowAfter = await AsyncStorage.getItem("sbq_sync_shadow");
    expect(JSON.parse(shadowAfter ?? "[]")).not.toContain("b1");
  });
});
