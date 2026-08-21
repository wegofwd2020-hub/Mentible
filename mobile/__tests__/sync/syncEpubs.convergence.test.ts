// End-to-end convergence regression test for the EPUB pull path.
//
// THE BUG (whole-branch review, HIGH): syncEpubs' pull path called
// `epubLibrary.saveEpub({ bookId, title, bytes, coverSvg })` WITHOUT
// `compiledAt`. `saveEpub` (both webSave and nativeSave) then unconditionally
// stamped `compiledAt: new Date().toISOString()` — "now" — instead of the
// original compile time carried in the synced meta. Consequence: device B
// pulls epub X@T1 from device A, saves it locally as X@T2(now) > T1. B's
// very next `syncEpubs` reconcile (`planReconcile`) then sees
// local.updatedAt (T2) > server.clientVersion (T1) and re-pushes the WHOLE
// (potentially tens-of-MB) epub back to the server, which A then pulls and
// re-saves as X@T3(now) > T2, re-pushing it right back — an infinite
// multi-MB ping-pong, with `syncStatus` showing a permanently "pending"
// badge the whole time. Books never had this bug (`saveBook` preserves
// `book.updatedAt` verbatim); shelves never had it either
// (`importShelvesDoc` sets `updatedAt` = the server's `client_version`).
// EPUB was the lone regressor because `saveEpub` is also the LOCAL-AUTHOR
// save path, which legitimately wants "now" — the fix is threading the
// pulled meta's `compiledAt` through as an explicit override.
//
// This file deliberately does NOT mock `@/storage/epubLibrary` — it uses the
// REAL module (native file+index path; jest-expo defaults Platform.OS to
// "ios") backed by a hand-rolled in-memory `expo-file-system` mock (same
// shape as `__tests__/storage/epubLibrary.test.ts`), so the assertions below
// exercise the actual `saveEpub` default-timestamp behavior end-to-end,
// rather than trusting a test double's assumption about it.

jest.mock("@/sync/syncClient");
jest.mock("@/crypto/envelope");
jest.mock("@/storage/bookStore");
jest.mock("@/storage/shelfStore");
jest.mock("@/sync/lmkStore");

jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  return {
    __esModule: true,
    documentDirectory: "file:///docs/",
    EncodingType: { Base64: "base64" },
    getInfoAsync: jest.fn((uri: string) => Promise.resolve({ exists: uri in files })),
    makeDirectoryAsync: jest.fn((uri: string) => {
      files[uri] = "<dir>";
      return Promise.resolve();
    }),
    writeAsStringAsync: jest.fn((uri: string, contents: string) => {
      files[uri] = contents;
      return Promise.resolve();
    }),
    readAsStringAsync: jest.fn((uri: string) => Promise.resolve(files[uri] ?? "")),
    deleteAsync: jest.fn((uri: string) => {
      delete files[uri];
      return Promise.resolve();
    }),
    __files: files,
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as syncClient from "@/sync/syncClient";
import * as envelope from "@/crypto/envelope";
import { packEpubBody } from "@/sync/epubFraming";
import { syncEpubs, planReconcile } from "@/sync/syncEngine";
import { listEpubs as listLocalEpubs } from "@/storage/epubLibrary";
import type { EpubMetaRow } from "@/sync/syncClient";

const mSyncClient = syncClient as jest.Mocked<typeof syncClient>;
const mEnvelope = envelope as jest.Mocked<typeof envelope>;

const bytes = (n: number, seed = 1) => {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * seed + 11) % 256;
  return u;
};

// A REAL (if trivial) transform — every byte flipped — so this doesn't rely
// on a pass-through mock to "decrypt".
function xorObfuscate(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ 0xff;
  return out;
}

const LMK = bytes(32, 2);
const TOKEN = "session-token";

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();

  mEnvelope.generateKey.mockReturnValue(bytes(32, 5));
  mEnvelope.seal.mockImplementation((_key: Uint8Array, data: Uint8Array) => ({
    nonce: bytes(12, 8),
    ct: xorObfuscate(data),
  }));
  mEnvelope.open.mockImplementation((_key: Uint8Array, _nonce: Uint8Array, ct: Uint8Array) => xorObfuscate(ct));
});

it("CONVERGENCE: a pulled epub's local compiledAt matches the server's client_version, so the immediate next reconcile does NOT re-push it", async () => {
  const compiledAt = "2026-03-05T00:00:00.000Z";
  const epubBytes = new Uint8Array([9, 8, 7, 6]);
  const metaJson = JSON.stringify({ title: "Pulled Book", compiledAt });
  const framedBody = packEpubBody(
    xorObfuscate(new TextEncoder().encode(metaJson)),
    xorObfuscate(epubBytes),
  );

  const serverManifest: EpubMetaRow[] = [
    { epubId: "e2", clientVersion: compiledAt, deleted: false, updatedAt: compiledAt, byteSize: epubBytes.length },
  ];
  mSyncClient.listEpubs.mockResolvedValue(serverManifest);
  mSyncClient.getEpub.mockResolvedValue({
    framedBody,
    headers: {
      nonce: bytes(12),
      metaNonce: bytes(12, 2),
      wrappedDk: bytes(48),
      dkNonce: bytes(12, 3),
      clientVersion: compiledAt,
    },
  });

  // First run: nothing local yet → pulls and saves via the REAL epubLibrary.
  const firstResult = await syncEpubs(TOKEN, LMK);
  expect(firstResult.pulledEpubs).toBe(1);

  // The REAL local index now reflects whatever `saveEpub` actually stamped.
  // If the regression reappears (compiledAt omitted from the saveEpub call),
  // this would be a fresh now() — strictly LATER than the server's
  // compiledAt — not equal to it.
  const localAfterPull = await listLocalEpubs();
  expect(localAfterPull).toHaveLength(1);
  expect(localAfterPull[0].compiledAt).toBe(compiledAt); // == server's client_version, NOT now()

  // The actual regression guard: planReconcile on this real local state
  // against the SAME, unchanged server manifest must NOT want to push it
  // again — local and server are equal, not "local newer".
  const localIndex = localAfterPull.map((m) => ({ id: m.id, updatedAt: m.compiledAt }));
  const plan = planReconcile(localIndex, serverManifest.map((e) => ({
    bookId: e.epubId,
    clientVersion: e.clientVersion,
    deleted: e.deleted,
    updatedAt: e.updatedAt,
  })), new Set(["e2"]));
  expect(plan.toPush).toEqual([]);
  expect(plan.equalKeep).toEqual(["e2"]);

  // Belt-and-suspenders: run the REAL syncEpubs a SECOND time (the actual
  // ping-pong path in production) — it must not call putEpub for e2.
  mSyncClient.putEpub.mockResolvedValue(undefined);
  const secondResult = await syncEpubs(TOKEN, LMK);
  expect(secondResult.pushedEpubs).toBe(0);
  expect(mSyncClient.putEpub).not.toHaveBeenCalled();
});
