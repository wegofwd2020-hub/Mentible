// syncEpubs (T5, folded into syncNow) — the EPUB half of ADR-014 increment 2.
// Same LWW reconcile shape as the book sync (`planReconcile`, its OWN shadow
// key `sbq_sync_epub_shadow`), but BOTH the epub bytes AND the small metadata
// blob (title/compiledAt/coverSvg) are sealed independently under a fresh
// per-epub data key wrapped by the LMK, then framed into one octet-stream
// body via the REAL `packEpubBody`/`unpackEpubBody` (T3 — not mocked, so the
// framing itself is exercised, not just asserted-on-faith).
//
// syncClient, envelope, and epubLibrary are mocked. `envelope.seal`/`open`
// use a REAL (if trivial) byte-flip transform — not a pass-through — so a
// regression that forwards plaintext straight through as "ciphertext"
// actually fails the "no plaintext on the wire" assertions below, same
// discipline as syncEngine.test.ts's book-push tests.

jest.mock("@/sync/syncClient");
jest.mock("@/crypto/envelope");
jest.mock("@/storage/epubLibrary");
jest.mock("@/storage/bookStore");
jest.mock("@/storage/shelfStore");
jest.mock("@/sync/lmkStore");

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as syncClient from "@/sync/syncClient";
import * as envelope from "@/crypto/envelope";
import * as epubLibrary from "@/storage/epubLibrary";
import { ApiError } from "@/api/client";
import { packEpubBody, unpackEpubBody } from "@/sync/epubFraming";
import { syncEpubs } from "@/sync/syncEngine";
import type { EpubMeta } from "@/storage/epubLibrary";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mEnvelope = envelope as jest.Mocked<typeof envelope>;
const mEpubLibrary = epubLibrary as jest.Mocked<typeof epubLibrary>;

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

  mEpubLibrary.listEpubs.mockResolvedValue([]);
  mSyncClient.listEpubs.mockResolvedValue([]);
});

describe("syncEpubs — push", () => {
  it("pushes a local-only epub: putEpub called with a framed body whose bytes are NOT the plaintext title/epub content", async () => {
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

    const [token, id, framedBody, headers] = mSyncClient.putEpub.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(id).toBe("e1");
    expect(headers.clientVersion).toBe(meta.compiledAt);
    expect(headers.nonce).toBeInstanceOf(Uint8Array);
    expect(headers.metaNonce).toBeInstanceOf(Uint8Array);
    expect(headers.wrappedDk).toBeInstanceOf(Uint8Array);
    expect(headers.dkNonce).toBeInstanceOf(Uint8Array);

    // GLOBAL CONSTRAINT under test, made real: raw-decoding the framed body
    // (as an attacker without the key would) must surface neither the
    // plaintext title nor the plaintext epub content.
    const decodedRaw = new TextDecoder().decode(framedBody);
    expect(decodedRaw).not.toContain("DISTINCTIVE EPUB TITLE");
    expect(decodedRaw).not.toContain(PLAINTEXT_MARKER);

    // Unframe with the REAL packEpubBody/unpackEpubBody (T3) and confirm each
    // half decrypts (via the test's xorObfuscate inverse) back to the exact
    // plaintext — proving the framing round-trips, not just that it's opaque.
    const { metaCt, epubCt } = unpackEpubBody(framedBody);
    expect(xorObfuscate(epubCt)).toEqual(epubBytes);
    const decryptedMeta = JSON.parse(new TextDecoder().decode(xorObfuscate(metaCt))) as {
      title: string;
      compiledAt: string;
    };
    expect(decryptedMeta).toEqual({ title: meta.title, compiledAt: meta.compiledAt });
  });

  it("a 413 during a push routes the id to `skipped` (not `failed`) and other pushes continue", async () => {
    const okMeta = makeMeta({ id: "ok", compiledAt: "2026-02-01T00:00:00.000Z" });
    const bigMeta = makeMeta({ id: "big", title: "Huge Book", compiledAt: "2026-02-01T00:00:00.000Z" });

    mEpubLibrary.listEpubs.mockResolvedValue([okMeta, bigMeta]);
    mEpubLibrary.getEpubBytes.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpub.mockImplementation(async (_t, id) => {
      if (id === "big") throw new ApiError(413, "epub too large");
    });

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.pushedEpubs).toBe(1);
    expect(result.skipped).toEqual(["big"]);
    expect(result.failed).toEqual([]);

    // The skipped id must NOT be added to the epub shadow — a later run
    // should retry it, not treat it as already-synced.
    const shadowRaw = await AsyncStorage.getItem("sbq_sync_epub_shadow");
    expect(JSON.parse(shadowRaw ?? "[]")).not.toContain("big");
    expect(JSON.parse(shadowRaw ?? "[]")).toContain("ok");
  });

  it("a non-413 error during a push is reported in `failed`, not `skipped`", async () => {
    const meta = makeMeta({ id: "e1" });
    mEpubLibrary.listEpubs.mockResolvedValue([meta]);
    mEpubLibrary.getEpubBytes.mockResolvedValue(new Uint8Array([1]).buffer);
    mSyncClient.listEpubs.mockResolvedValue([]);
    mSyncClient.putEpub.mockRejectedValue(new Error("network blip"));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result.failed).toEqual(["e1"]);
    expect(result.skipped).toEqual([]);
  });
});

describe("syncEpubs — pull", () => {
  it("pulls a server-newer epub: getEpub → unpackEpubBody → decrypt → saveEpub with the right title/bytes", async () => {
    const compiledAt = "2026-03-05T00:00:00.000Z";
    const epubBytes = new Uint8Array([9, 8, 7, 6]);
    const metaJson = JSON.stringify({ title: "Pulled Book", compiledAt, coverSvg: "<svg/>" });
    const framedBody = packEpubBody(xorObfuscate(new TextEncoder().encode(metaJson)), xorObfuscate(epubBytes));

    mSyncClient.listEpubs.mockResolvedValue([
      { epubId: "e2", clientVersion: compiledAt, deleted: false, updatedAt: compiledAt, byteSize: 4 },
    ]);
    mEpubLibrary.listEpubs.mockResolvedValue([]); // not present locally
    mSyncClient.getEpub.mockResolvedValue({
      framedBody,
      headers: { nonce: bytes(12), metaNonce: bytes(12, 2), wrappedDk: bytes(48), dkNonce: bytes(12, 3), clientVersion: compiledAt },
    });
    mEpubLibrary.saveEpub.mockResolvedValue(makeMeta({ id: "e2", title: "Pulled Book", compiledAt }));

    const result = await syncEpubs(TOKEN, LMK);

    expect(result).toEqual({ pushedEpubs: 0, pulledEpubs: 1, deletedEpubs: 0, failed: [], skipped: [] });
    expect(mSyncClient.getEpub).toHaveBeenCalledWith(TOKEN, "e2");
    expect(mEpubLibrary.saveEpub).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "e2", title: "Pulled Book", coverSvg: "<svg/>" }),
    );
    const savedBytes = mEpubLibrary.saveEpub.mock.calls[0][0].bytes;
    expect(new Uint8Array(savedBytes)).toEqual(epubBytes);
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
    expect(mSyncClient.getEpub).not.toHaveBeenCalled();
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

    const shadowAfter = await AsyncStorage.getItem("sbq_sync_epub_shadow");
    expect(JSON.parse(shadowAfter ?? "[]")).not.toContain("e4");
  });
});
