// syncEpubs (T5/T6, folded into syncNow) — the EPUB half of ADR-014
// increment 2 / 2.1: platform-branched push/pull transport + richer
// per-book skip records.
//
// jest-expo defaults `Platform.OS` to native ("ios"), so the top-level
// describe blocks below run the NATIVE branch (file-to-file crypto via
// `epubFileCrypto` + `syncClient.putEpubFile`/`getEpubToFile`) under the
// ambient default. The dedicated "web branch" describe block forces
// `Platform.OS = "web"` for its duration (repo convention — see e.g.
// `__tests__/components/ChapterRenderer.switch.test.tsx`) and restores
// "ios" afterward, exercising the in-memory `@noble` path via `epubCrypto`
// + `syncClient.putEpub`/`getEpub` instead.
//
// syncClient, envelope, epubCrypto, epubFileCrypto, and epubLibrary are all
// mocked. `envelope.seal`/`open` AND `epubCrypto`'s
// `sealEpubBytesWeb`/`openEpubBytesWeb` use a REAL (if trivial) byte-flip
// transform (`xorObfuscate`, XOR 0xff) — not a pass-through — so a
// regression that forwards plaintext straight through as "ciphertext"
// actually fails the "no plaintext on the wire" assertions below, same
// discipline as syncEngine.test.ts's book-push tests.

jest.mock("@/sync/syncClient");
jest.mock("@/crypto/envelope");
jest.mock("@/crypto/epubCrypto");
jest.mock("@/crypto/epubFileCrypto");
jest.mock("@/storage/epubLibrary");
jest.mock("@/storage/bookStore");
jest.mock("@/storage/shelfStore");
jest.mock("@/sync/lmkStore");
jest.mock("expo-file-system", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  deleteAsync: jest.fn(() => Promise.resolve()),
}));

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import * as syncClient from "@/sync/syncClient";
import * as envelope from "@/crypto/envelope";
import * as epubCrypto from "@/crypto/epubCrypto";
import * as epubFileCrypto from "@/crypto/epubFileCrypto";
import * as epubLibrary from "@/storage/epubLibrary";
import { ApiError } from "@/api/client";
import { syncEpubs } from "@/sync/syncEngine";
import type { EpubMeta } from "@/storage/epubLibrary";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mEnvelope = envelope as jest.Mocked<typeof envelope>;
const mEpubCrypto = epubCrypto as jest.Mocked<typeof epubCrypto>;
const mEpubFileCrypto = epubFileCrypto as jest.Mocked<typeof epubFileCrypto>;
const mEpubLibrary = epubLibrary as jest.Mocked<typeof epubLibrary>;
const mFileSystem = FileSystem as jest.Mocked<typeof FileSystem>;

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

function makeMeta(overrides: Partial<EpubMeta> = {}): EpubMeta {
  return {
    id: "e1",
    title: "A DISTINCTIVE EPUB TITLE THAT MUST NEVER LEAVE THE DEVICE",
    sizeBytes: 5,
    compiledAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  mEnvelope.generateKey.mockReturnValue(bytes(32, 5));
  mEnvelope.seal.mockImplementation((_key: Uint8Array, data: Uint8Array) => ({
    nonce: bytes(12, 8),
    ct: xorObfuscate(data),
  }));
  mEnvelope.open.mockImplementation((_key: Uint8Array, _nonce: Uint8Array, ct: Uint8Array) => xorObfuscate(ct));

  mEpubCrypto.sealEpubBytesWeb.mockImplementation((_dk: Uint8Array, epubBytes: Uint8Array) => ({
    nonce: bytes(12, 9),
    tag: bytes(16, 10),
    ct: xorObfuscate(epubBytes),
  }));
  mEpubCrypto.openEpubBytesWeb.mockImplementation((_dk: Uint8Array, _nonce: Uint8Array, _tag: Uint8Array, ct: Uint8Array) =>
    xorObfuscate(ct),
  );

  mEpubFileCrypto.sealEpubFileNative.mockResolvedValue({ nonce: bytes(12, 11), tag: bytes(16, 12) });
  mEpubFileCrypto.openEpubFileNative.mockResolvedValue(undefined);

  mEpubLibrary.listEpubs.mockResolvedValue([]);
  mSyncClient.listEpubs.mockResolvedValue([]);
});

describe("syncEpubs — push (native, default Platform.OS)", () => {
  it("native push: sealEpubFileNative(dk, getEpubFileUri(id), tmp) -> putEpubFile -> tmp cleanup; no plaintext meta on the wire", async () => {
    const meta = makeMeta({ id: "e1", compiledAt: "2026-02-01T00:00:00.000Z" });

    mEpubLibrary.listEpubs.mockResolvedValue([meta]);
    mEpubLibrary.getEpubFileUri.mockReturnValue("file:///docs/epubs/e1.epub");
    mSyncClient.listEpubs.mockResolvedValue([]); // nothing on the server yet
    mSyncClient.putEpubFile.mockResolvedValue(undefined);

    const result = await syncEpubs(TOKEN, LMK);

    expect(result).toEqual({ pushedEpubs: 1, pulledEpubs: 0, deletedEpubs: 0, failed: [], skipped: [] });

    expect(mEpubFileCrypto.sealEpubFileNative).toHaveBeenCalledTimes(1);
    const [, inUri, outUri] = mEpubFileCrypto.sealEpubFileNative.mock.calls[0];
    expect(inUri).toBe("file:///docs/epubs/e1.epub");
    expect(outUri).toBe("file:///cache/sync-ct-e1.bin");

    expect(mSyncClient.putEpubFile).toHaveBeenCalledTimes(1);
    const [token, id, ctUri, headers] = mSyncClient.putEpubFile.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(id).toBe("e1");
    expect(ctUri).toBe(outUri);
    expect(headers.clientVersion).toBe(meta.compiledAt);
    expect(headers.nonce).toBeInstanceOf(Uint8Array);
    expect(headers.tag).toBeInstanceOf(Uint8Array);
    expect(headers.wrappedDk).toBeInstanceOf(Uint8Array);
    expect(headers.dkNonce).toBeInstanceOf(Uint8Array);

    // GLOBAL CONSTRAINT under test: the meta ciphertext header must not
    // decode to reveal the plaintext title; decrypting it (via the test's
    // xorObfuscate inverse) must round-trip to the exact plaintext meta.
    const decodedRaw = new TextDecoder().decode(headers.metaCt);
    expect(decodedRaw).not.toContain("DISTINCTIVE EPUB TITLE");
    const decryptedMeta = JSON.parse(new TextDecoder().decode(xorObfuscate(headers.metaCt))) as {
      title: string;
      compiledAt: string;
    };
    expect(decryptedMeta).toEqual({ title: meta.title, compiledAt: meta.compiledAt });

    // Temp ciphertext file is cleaned up in `finally`, regardless of outcome.
    expect(mFileSystem.deleteAsync).toHaveBeenCalledWith(outUri, { idempotent: true });
  });

  it("413 with detail 'epub too large' -> explicit skip record {id,title,sizeBytes,reason:'too_large'}", async () => {
    const bigMeta = makeMeta({ id: "big", title: "Huge Book", sizeBytes: 999, compiledAt: "2026-02-01T00:00:00.000Z" });

    mEpubLibrary.listEpubs.mockResolvedValue([bigMeta]);
    mEpubLibrary.getEpubFileUri.mockReturnValue("file:///docs/epubs/big.epub");
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpubFile.mockRejectedValue(new ApiError(413, "epub too large"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.pushedEpubs).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([{ id: "big", title: "Huge Book", sizeBytes: 999, reason: "too_large" }]);

    // The skipped id must NOT be added to the epub shadow — a later run
    // should retry it, not treat it as already-synced.
    const shadowRaw = await AsyncStorage.getItem("sbq_sync_epub_shadow");
    expect(JSON.parse(shadowRaw ?? "[]")).not.toContain("big");

    // Temp file cleanup still runs even though the push failed.
    expect(mFileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/sync-ct-big.bin", { idempotent: true });
  });

  it("413 with detail 'sync storage full' -> reason 'storage_full'", async () => {
    const bigMeta = makeMeta({ id: "big2", title: "Another Huge Book", sizeBytes: 42, compiledAt: "2026-02-01T00:00:00.000Z" });

    mEpubLibrary.listEpubs.mockResolvedValue([bigMeta]);
    mEpubLibrary.getEpubFileUri.mockReturnValue("file:///docs/epubs/big2.epub");
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpubFile.mockRejectedValue(new ApiError(413, "sync storage full"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.skipped).toEqual([{ id: "big2", title: "Another Huge Book", sizeBytes: 42, reason: "storage_full" }]);
  });

  it("a non-413 error during a push is reported in `failed`, not `skipped`", async () => {
    const meta = makeMeta({ id: "e1" });
    mEpubLibrary.listEpubs.mockResolvedValue([meta]);
    mEpubLibrary.getEpubFileUri.mockReturnValue("file:///docs/epubs/e1.epub");
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpubFile.mockRejectedValue(new Error("network blip"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.failed).toEqual(["e1"]);
    expect(result.skipped).toEqual([]);
  });

  it("multiple local-only epubs: one 413's, the rest still push", async () => {
    const okMeta = makeMeta({ id: "ok", compiledAt: "2026-02-01T00:00:00.000Z" });
    const bigMeta = makeMeta({ id: "big", title: "Huge Book", compiledAt: "2026-02-01T00:00:00.000Z" });

    mEpubLibrary.listEpubs.mockResolvedValue([okMeta, bigMeta]);
    mEpubLibrary.getEpubFileUri.mockImplementation((id: string) => `file:///docs/epubs/${id}.epub`);
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpubFile.mockImplementation(async (_t, id) => {
      if (id === "big") throw new ApiError(413, "epub too large");
    });

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.pushedEpubs).toBe(1);
    expect(result.skipped).toEqual([{ id: "big", title: "Huge Book", sizeBytes: bigMeta.sizeBytes, reason: "too_large" }]);
    expect(result.failed).toEqual([]);

    const shadowRaw = await AsyncStorage.getItem("sbq_sync_epub_shadow");
    expect(JSON.parse(shadowRaw ?? "[]")).not.toContain("big");
    expect(JSON.parse(shadowRaw ?? "[]")).toContain("ok");
  });
});

describe("syncEpubs — pull (native, default Platform.OS)", () => {
  it("native pull: getEpubToFile -> openEpubFileNative -> saveEpubFileNative, threading the server's compiledAt (convergence)", async () => {
    const compiledAt = "2026-03-05T00:00:00.000Z";
    const metaJson = JSON.stringify({ title: "Pulled Book", compiledAt });
    const metaCt = xorObfuscate(new TextEncoder().encode(metaJson));

    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e2", clientVersion: compiledAt, deleted: false, updatedAt: compiledAt, byteSize: 4 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([]); // not present locally
    mSyncClient.getEpubToFile.mockResolvedValue({
      headers: {
        nonce: bytes(12),
        tag: bytes(16),
        metaCt,
        metaNonce: bytes(12, 2),
        wrappedDk: bytes(48),
        dkNonce: bytes(12, 3),
        clientVersion: compiledAt,
      },
    });
    mEpubLibrary.saveEpubFileNative.mockResolvedValue(makeMeta({ id: "e2", title: "Pulled Book", compiledAt }));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result).toEqual({ pushedEpubs: 0, pulledEpubs: 1, deletedEpubs: 0, failed: [], skipped: [] });

    expect(mSyncClient.getEpubToFile).toHaveBeenCalledWith(TOKEN, "e2", "file:///cache/sync-ct-e2.bin");
    expect(mEpubFileCrypto.openEpubFileNative).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      "file:///cache/sync-ct-e2.bin",
      "file:///cache/sync-plain-e2.bin",
    );
    expect(mEpubLibrary.saveEpubFileNative).toHaveBeenCalledWith({
      bookId: "e2",
      title: "Pulled Book",
      compiledAt, // CONVERGENCE: the server's client_version, NOT a fresh now()
      plaintextUri: "file:///cache/sync-plain-e2.bin",
    });

    // Both temp files are cleaned up.
    expect(mFileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/sync-ct-e2.bin", { idempotent: true });
    expect(mFileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/sync-plain-e2.bin", { idempotent: true });
  });

  it("a pull failure (e.g. openEpubFileNative throws) is reported in `failed`", async () => {
    const compiledAt = "2026-03-05T00:00:00.000Z";
    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e9", clientVersion: compiledAt, deleted: false, updatedAt: compiledAt, byteSize: 4 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([]);
    mSyncClient.getEpubToFile.mockResolvedValue({
      headers: {
        nonce: bytes(12),
        tag: bytes(16),
        metaCt: bytes(4),
        metaNonce: bytes(12, 2),
        wrappedDk: bytes(48),
        dkNonce: bytes(12, 3),
        clientVersion: compiledAt,
      },
    });
    mEpubFileCrypto.openEpubFileNative.mockRejectedValue(new Error("tamper detected"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.failed).toEqual(["e9"]);
    expect(result.pulledEpubs).toBe(0);
    expect(mEpubLibrary.saveEpubFileNative).not.toHaveBeenCalled();
  });
});

describe("syncEpubs — web branch (forced Platform.OS = 'web')", () => {
  beforeAll(() => {
    Platform.OS = "web";
  });
  afterAll(() => {
    Platform.OS = "ios";
  });

  it("web push: seals ct-only bytes + meta header via sealEpubBytesWeb, PUTs via putEpub, shadows", async () => {
    const PLAINTEXT_MARKER = "EPUB-BYTES-PLAINTEXT-MARKER-1234567890";
    const epubBytes = new TextEncoder().encode(PLAINTEXT_MARKER);
    const meta = makeMeta({ id: "e1", compiledAt: "2026-02-01T00:00:00.000Z" });

    mEpubLibrary.listEpubs.mockResolvedValue([meta]);
    mEpubLibrary.getEpubBytes.mockResolvedValue(epubBytes.buffer as ArrayBuffer);
    mSyncClient.listEpubs.mockResolvedValue([]); // nothing on the server yet
    mSyncClient.putEpub.mockResolvedValue(undefined);

    const result = await syncEpubs(TOKEN, LMK);

    expect(result).toEqual({ pushedEpubs: 1, pulledEpubs: 0, deletedEpubs: 0, failed: [], skipped: [] });
    expect(mSyncClient.putEpub).toHaveBeenCalledTimes(1);
    expect(mEpubFileCrypto.sealEpubFileNative).not.toHaveBeenCalled();

    const [token, id, ct, headers] = mSyncClient.putEpub.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(id).toBe("e1");
    expect(headers.clientVersion).toBe(meta.compiledAt);
    expect(headers.nonce).toBeInstanceOf(Uint8Array);
    expect(headers.tag).toBeInstanceOf(Uint8Array);

    // GLOBAL CONSTRAINT: neither the ciphertext arg nor the meta header
    // decode to plaintext.
    expect(new TextDecoder().decode(ct)).not.toContain(PLAINTEXT_MARKER);
    expect(xorObfuscate(ct)).toEqual(epubBytes); // sealEpubBytesWeb's mock round-trips
    const decryptedMeta = JSON.parse(new TextDecoder().decode(xorObfuscate(headers.metaCt))) as {
      title: string;
      compiledAt: string;
    };
    expect(decryptedMeta).toEqual({ title: meta.title, compiledAt: meta.compiledAt });
  });

  it("web pull: getEpub -> openEpubBytesWeb -> saveEpub with the server's compiledAt (convergence)", async () => {
    const compiledAt = "2026-03-05T00:00:00.000Z";
    const epubBytes = new Uint8Array([9, 8, 7, 6]);
    const metaJson = JSON.stringify({ title: "Pulled Book", compiledAt });

    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e2", clientVersion: compiledAt, deleted: false, updatedAt: compiledAt, byteSize: 4 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([]); // not present locally
    mSyncClient.getEpub.mockResolvedValue({
      ct: xorObfuscate(epubBytes),
      headers: {
        nonce: bytes(12),
        tag: bytes(16),
        metaCt: xorObfuscate(new TextEncoder().encode(metaJson)),
        metaNonce: bytes(12, 2),
        wrappedDk: bytes(48),
        dkNonce: bytes(12, 3),
        clientVersion: compiledAt,
      },
    });
    mEpubLibrary.saveEpub.mockResolvedValue(makeMeta({ id: "e2", title: "Pulled Book", compiledAt }));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result).toEqual({ pushedEpubs: 0, pulledEpubs: 1, deletedEpubs: 0, failed: [], skipped: [] });
    expect(mSyncClient.getEpub).toHaveBeenCalledWith(TOKEN, "e2");
    expect(mEpubLibrary.saveEpub).toHaveBeenCalledWith({
      bookId: "e2",
      title: "Pulled Book",
      bytes: expect.any(ArrayBuffer),
      compiledAt, // CONVERGENCE: the server's client_version, NOT a fresh now()
    });
    const savedBytes = mEpubLibrary.saveEpub.mock.calls[0][0].bytes;
    expect(new Uint8Array(savedBytes)).toEqual(epubBytes);
  });

  it("413 with detail 'epub too large' during a web push -> explicit skip record", async () => {
    const bigMeta = makeMeta({ id: "big", title: "Huge Book", sizeBytes: 555, compiledAt: "2026-02-01T00:00:00.000Z" });
    mEpubLibrary.listEpubs.mockResolvedValue([bigMeta]);
    mEpubLibrary.getEpubBytes.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpub.mockRejectedValue(new ApiError(413, "epub too large"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.skipped).toEqual([{ id: "big", title: "Huge Book", sizeBytes: 555, reason: "too_large" }]);
  });

  it("413 with detail 'sync storage full' during a web push -> reason 'storage_full'", async () => {
    const bigMeta = makeMeta({ id: "big3", compiledAt: "2026-02-01T00:00:00.000Z" });
    mEpubLibrary.listEpubs.mockResolvedValue([bigMeta]);
    mEpubLibrary.getEpubBytes.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpub.mockRejectedValue(new ApiError(413, "sync storage full"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.skipped).toEqual([{ id: "big3", title: bigMeta.title, sizeBytes: bigMeta.sizeBytes, reason: "storage_full" }]);
  });
});

describe("syncEpubs — regression guards", () => {
  it("REGRESSION GUARD: a live-equal epub with an EMPTY shadow still gets added to the shadow (prevents delete resurrection)", async () => {
    // Epub analogue of syncEngine.test.ts's book REGRESSION GUARD: the
    // live-both branch of `planReconcile` classifies a local/server pair with
    // matching timestamps as `equalKeep` (nothing to push/pull), but
    // `syncEpubs` must still `shadow.add()` it. Skipping that add (the bug
    // this guards against) means a later run — with the same epub still
    // live-equal but no shadow entry — would hit the "!local && server &&
    // !server.deleted" branch on a subsequent local delete and misclassify
    // it as "peer added", PULLING the epub back instead of pushing the
    // tombstone. Asserting on what `saveEpubShadow` actually persisted (not
    // just the EpubSyncResult counts) is the point of this test.
    const compiledAt = "2026-01-01T00:00:00.000Z";
    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e8", clientVersion: compiledAt, deleted: false, updatedAt: compiledAt, byteSize: 5 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([makeMeta({ id: "e8", compiledAt })]);
    // Shadow starts empty — nothing pre-seeded into AsyncStorage (beforeEach
    // already ran AsyncStorage.clear()), simulating a lost/never-built shadow.

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.pushedEpubs).toBe(0);
    expect(result.pulledEpubs).toBe(0);
    expect(mSyncClient.putEpubFile).not.toHaveBeenCalled();
    expect(mSyncClient.getEpubToFile).not.toHaveBeenCalled();

    const shadowRaw = await AsyncStorage.getItem("sbq_sync_epub_shadow");
    expect(JSON.parse(shadowRaw ?? "[]")).toContain("e8");
  });
});

describe("syncEpubs — delete", () => {
  it("a newer server tombstone deletes the epub locally", async () => {
    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e3", clientVersion: "2026-05-01T00:00:00.000Z", deleted: true, updatedAt: "2026-05-01T00:00:00.000Z", byteSize: 0 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([makeMeta({ id: "e3", compiledAt: "2026-01-01T00:00:00.000Z" })]);

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.deletedEpubs).toBe(1);
    expect(mEpubLibrary.deleteEpub).toHaveBeenCalledWith("e3");
    expect(mSyncClient.getEpubToFile).not.toHaveBeenCalled();
  });

  it("a local delete (present in the shadow, gone locally, server still live) pushes the tombstone", async () => {
    await AsyncStorage.setItem("sbq_sync_epub_shadow", JSON.stringify(["e4"]));
    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e4", clientVersion: "2026-01-01T00:00:00.000Z", deleted: false, updatedAt: "2026-01-01T00:00:00.000Z", byteSize: 10 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([]); // deleted locally
    mSyncClient.deleteEpub.mockResolvedValue(undefined);

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.deletedEpubs).toBe(1);
    expect(mSyncClient.deleteEpub).toHaveBeenCalledWith(TOKEN, "e4");
    expect(mEpubLibrary.saveEpub).not.toHaveBeenCalled();
    expect(mEpubLibrary.saveEpubFileNative).not.toHaveBeenCalled();

    const shadowAfter = await AsyncStorage.getItem("sbq_sync_epub_shadow");
    expect(JSON.parse(shadowAfter ?? "[]")).not.toContain("e4");
  });
});
