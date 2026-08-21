// syncShelves (T5, folded into syncNow) — the shelves half of ADR-014
// increment 2. A single-document LWW sync (no id path segment — one shelves
// doc per account), compared by `shelfStore.exportShelvesDoc().updatedAt`
// against the server's `client_version`, same last-write-wins rule as a book.
//
// DELIBERATE DEVIATION documented in syncEngine.ts: when nothing has ever
// been synced (`getShelves` → null) AND the local doc is genuinely empty (no
// shelves, no assignments — a fresh install that has never organized
// anything), the push is skipped rather than uploading an empty doc. A
// device with ANY real shelf/assignment state still pushes unconditionally
// against a null server, matching the brief's literal "server null → push".

jest.mock("@/sync/syncClient");
jest.mock("@/crypto/envelope");
jest.mock("@/storage/shelfStore");
jest.mock("@/storage/bookStore");
jest.mock("@/storage/epubLibrary");
jest.mock("@/sync/lmkStore");

import * as syncClient from "@/sync/syncClient";
import * as envelope from "@/crypto/envelope";
import * as shelfStore from "@/storage/shelfStore";
import { syncShelves } from "@/sync/syncEngine";
import type { ShelvesDoc } from "@/storage/shelfStore";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mEnvelope = envelope as jest.Mocked<typeof envelope>;
const mShelfStore = shelfStore as jest.Mocked<typeof shelfStore>;

const bytes = (n: number, seed = 1) => {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * seed + 11) % 256;
  return u;
};

// A REAL (if trivial) transform — every byte flipped — so a pass-through mock
// (the bug this discipline catches) fails the plaintext-leak assertions.
function xorObfuscate(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ 0xff;
  return out;
}

const LMK = bytes(32, 2);
const TOKEN = "session-token";

const EMPTY_DOC: ShelvesDoc = { shelves: [], assignments: {}, updatedAt: "1970-01-01T00:00:00.000Z" };

function makeDoc(overrides: Partial<ShelvesDoc> = {}): ShelvesDoc {
  return {
    shelves: [{ id: "s1", name: "A DISTINCTIVE SHELF NAME", createdAt: "2026-01-01T00:00:00.000Z", order: 0 }],
    assignments: { b1: "s1" },
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mEnvelope.generateKey.mockReturnValue(bytes(32, 5));
  mEnvelope.seal.mockImplementation((_key: Uint8Array, data: Uint8Array) => ({
    nonce: bytes(12, 8),
    ct: xorObfuscate(data),
  }));
  mEnvelope.open.mockImplementation((_key: Uint8Array, _nonce: Uint8Array, ct: Uint8Array) => xorObfuscate(ct));
});

describe("syncShelves — push", () => {
  it("local newer than server → putShelves called with ciphertext that is NOT the plaintext doc", async () => {
    const local = makeDoc({ updatedAt: "2026-06-01T00:00:00.000Z" });
    mShelfStore.exportShelvesDoc.mockResolvedValue(local);
    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: bytes(1),
      nonce: bytes(1),
      wrappedDk: bytes(1),
      dkNonce: bytes(1),
      clientVersion: "2026-01-01T00:00:00.000Z", // older than local
    });
    mSyncClient.putShelves.mockResolvedValue(undefined);

    const result = await syncShelves(TOKEN, LMK);

    expect(result).toEqual({ pushed: 1, pulled: 0, failed: [] });
    expect(mSyncClient.putShelves).toHaveBeenCalledTimes(1);
    const [token, blob] = mSyncClient.putShelves.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(blob.clientVersion).toBe(local.updatedAt);

    const decodedRaw = new TextDecoder().decode(blob.ciphertext);
    expect(decodedRaw).not.toContain("DISTINCTIVE SHELF NAME");
    // Round-trips back to the exact doc via the test's xorObfuscate inverse.
    const decrypted = JSON.parse(new TextDecoder().decode(xorObfuscate(blob.ciphertext))) as {
      shelves: unknown;
      assignments: unknown;
    };
    expect(decrypted).toEqual({ shelves: local.shelves, assignments: local.assignments });
  });

  it("server has nothing yet (null) and local has real shelves → pushes unconditionally", async () => {
    const local = makeDoc();
    mShelfStore.exportShelvesDoc.mockResolvedValue(local);
    mSyncClient.getShelves.mockResolvedValue(null);
    mSyncClient.putShelves.mockResolvedValue(undefined);

    const result = await syncShelves(TOKEN, LMK);

    expect(result).toEqual({ pushed: 1, pulled: 0, failed: [] });
    expect(mSyncClient.putShelves).toHaveBeenCalledTimes(1);
  });

  it("DEVIATION: server null AND local doc is genuinely empty → skipped, no putShelves call", async () => {
    mShelfStore.exportShelvesDoc.mockResolvedValue(EMPTY_DOC);
    mSyncClient.getShelves.mockResolvedValue(null);

    const result = await syncShelves(TOKEN, LMK);

    expect(result).toEqual({ pushed: 0, pulled: 0, failed: [] });
    expect(mSyncClient.putShelves).not.toHaveBeenCalled();
  });
});

describe("syncShelves — pull", () => {
  it("server newer than local → decrypt and importShelvesDoc with the server's client_version", async () => {
    const serverDoc = makeDoc({ updatedAt: "2026-07-01T00:00:00.000Z" });
    const docJson = JSON.stringify({ shelves: serverDoc.shelves, assignments: serverDoc.assignments });

    mShelfStore.exportShelvesDoc.mockResolvedValue(EMPTY_DOC); // local older/empty
    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: xorObfuscate(new TextEncoder().encode(docJson)),
      nonce: bytes(12),
      wrappedDk: bytes(32),
      dkNonce: bytes(12),
      clientVersion: serverDoc.updatedAt,
    });
    mShelfStore.importShelvesDoc.mockResolvedValue(undefined);

    const result = await syncShelves(TOKEN, LMK);

    expect(result).toEqual({ pushed: 0, pulled: 1, failed: [] });
    expect(mShelfStore.importShelvesDoc).toHaveBeenCalledWith({
      shelves: serverDoc.shelves,
      assignments: serverDoc.assignments,
      updatedAt: serverDoc.updatedAt,
    });
    expect(mSyncClient.putShelves).not.toHaveBeenCalled();
  });
});

describe("syncShelves — skip (equal)", () => {
  it("local.updatedAt === server.client_version → neither push nor pull", async () => {
    const same = "2026-08-01T00:00:00.000Z";
    mShelfStore.exportShelvesDoc.mockResolvedValue(makeDoc({ updatedAt: same }));
    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: bytes(1),
      nonce: bytes(1),
      wrappedDk: bytes(1),
      dkNonce: bytes(1),
      clientVersion: same,
    });

    const result = await syncShelves(TOKEN, LMK);

    expect(result).toEqual({ pushed: 0, pulled: 0, failed: [] });
    expect(mSyncClient.putShelves).not.toHaveBeenCalled();
    expect(mShelfStore.importShelvesDoc).not.toHaveBeenCalled();
  });
});

describe("syncShelves — error handling", () => {
  it("an error (e.g. a bad decrypt) is caught and reported as failed: ['shelves'], never thrown", async () => {
    mShelfStore.exportShelvesDoc.mockResolvedValue(EMPTY_DOC);
    mSyncClient.getShelves.mockResolvedValue({
      ciphertext: bytes(1),
      nonce: bytes(1),
      wrappedDk: bytes(1),
      dkNonce: bytes(1),
      clientVersion: "2099-01-01T00:00:00.000Z", // newer → pull branch
    });
    mEnvelope.open.mockImplementation(() => {
      throw new Error("cipher: message authentication failed");
    });

    const result = await syncShelves(TOKEN, LMK);

    expect(result).toEqual({ pushed: 0, pulled: 0, failed: ["shelves"] });
  });
});
