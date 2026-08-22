// The zero-knowledge library sync engine (ADR-014 increment 1). Not a React
// component/hook — the caller (Settings UI, T4) passes the session access
// token in explicitly on every call. This is the only module that wires the
// crypto envelope (`crypto/envelope.ts`), the LMK device cache
// (`sync/lmkStore.ts`), the sync wire client (`sync/syncClient.ts`), and local
// book storage (`storage/bookStore.ts`) together. The LMK is decrypted only
// in memory here (and inside `envelope.ts`) — it is never logged, and the
// only place it is persisted is `lmkStore`'s device-local secure cache.
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Book } from "@/types/book";
import {
  generateRecoveryKey,
  generateKey,
  randomSalt,
  deriveKEK,
  seal,
  open,
  encryptBook,
  decryptBook,
} from "@/crypto/envelope";
import { sealEpubBytesWeb, openEpubBytesWeb } from "@/crypto/epubCrypto";
import { sealEpubFileNative, openEpubFileNative } from "@/crypto/epubFileCrypto";
import * as syncClient from "@/sync/syncClient";
import { ApiError } from "@/api/client";
import { saveLMK, loadLMK } from "@/sync/lmkStore";
import { loadBookIndex, loadBook, saveBook, deleteBook as deleteLocalBook } from "@/storage/bookStore";
import * as epubLibrary from "@/storage/epubLibrary";
import * as shelfStore from "@/storage/shelfStore";
import type { Shelf } from "@/storage/shelfStore";

const LAST_SYNCED_KEY = "sbq_sync_last_synced_at"; // not a secret — plain AsyncStorage is fine

// The "sync shadow": the set of book ids this device believes are currently
// synced to the server (present there, not tombstoned), as of the end of the
// last successful `syncNow`. IDs only — not a secret, plain AsyncStorage is
// fine. This is what lets the reconcile tell "this device never had book X"
// (not in shadow, not local → pull if server has it) apart from "this device
// HAD book X and deleted it locally" (in shadow, not local anymore → push
// the tombstone) — a plain local/server id union can't distinguish those two
// and either resurrects a local delete or drops a peer's tombstone.
const SHADOW_KEY = "sbq_sync_shadow";
// Same shape and role as SHADOW_KEY, but for the EPUB library (ADR-014
// increment 2) — a SEPARATE key so a book id and an epub id sharing the same
// value (they're both `book.id`-keyed) can never cross-contaminate each
// other's shadow membership.
const EPUB_SHADOW_KEY = "sbq_sync_epub_shadow";

async function loadShadow(key: string = SHADOW_KEY): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function saveShadow(shadow: Set<string>, key: string = SHADOW_KEY): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify([...shadow]));
}

function loadEpubShadow(): Promise<Set<string>> {
  return loadShadow(EPUB_SHADOW_KEY);
}

function saveEpubShadow(shadow: Set<string>): Promise<void> {
  return saveShadow(shadow, EPUB_SHADOW_KEY);
}

// Thrown by `syncNow` when no LMK is cached on this device (never synced yet,
// or a new device that hasn't run `unlockOnDevice`). The caller should route
// the user to the enable/unlock flow — `syncNow` never pushes plaintext (or
// anything at all) in this state.
export class SyncLockedError extends Error {
  constructor() {
    super("Sync is locked on this device — unlock or enable sync first.");
    this.name = "SyncLockedError";
  }
}

// Thrown by `enableSync` when the account already has a keyset on the server
// (PUT /keyset without force → 409). The caller should route to
// `unlockOnDevice` instead of silently overwriting an existing keyset.
export class SyncKeysetExistsError extends Error {
  constructor() {
    super("Sync is already enabled for this account — unlock this device instead.");
    this.name = "SyncKeysetExistsError";
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  failed: string[];
  // EPUBs skipped this run because a 413 (single-file or per-account cap)
  // rejected the push — deliberately NOT `failed` (a fixable-by-the-user cap,
  // not a bug/network blip) and NOT added to the epub shadow (so a future
  // sync, e.g. after the user frees space, retries the push rather than
  // silently treating it as already-synced). Books never contribute here.
  // Richer than a bare id (was `string[]`) so the UI can say WHICH book, how
  // big, and why — see `EpubSkip` below.
  skipped: EpubSkip[];
}

// Whether this device already has an LMK cached (i.e. can sync without a
// recovery-key prompt). Convenience for the Settings UI (T4) to pick a state.
export async function isUnlocked(): Promise<boolean> {
  return (await loadLMK()) !== null;
}

// Turn on sync for this account: generates a fresh recovery key + LMK,
// wraps the LMK under a KEK derived from the recovery key, and uploads the
// wrapped envelope. Returns the recovery key so the caller can show it to the
// user EXACTLY ONCE — it is never stored or logged anywhere; losing it means
// losing the ability to unlock a new device (the exported EPUB/PDF is the
// fallback, ADR-014 O4). Never overwrites an existing server-side keyset —
// that would silently orphan any other device already using it.
export async function enableSync(token: string): Promise<string> {
  const recoveryKey = generateRecoveryKey();
  const lmk = generateKey();
  const kekSalt = randomSalt();
  const kek = deriveKEK(recoveryKey, kekSalt);
  const wrapped = seal(kek, lmk);

  try {
    await syncClient.putKeyset(token, {
      wrappedLmk: wrapped.ct,
      lmkNonce: wrapped.nonce,
      kekSalt,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new SyncKeysetExistsError();
    throw e;
  }

  await saveLMK(lmk);
  return recoveryKey;
}

// Unlock sync on this device using the recovery key (new device, or after
// `clearLMK`): fetches the account's wrapped keyset, re-derives the KEK, and
// unwraps the LMK. `open()` throws on a wrong key (AEAD tamper/auth
// failure) — that throw propagates as-is and the LMK is NEVER cached in that
// case, so a wrong guess can't leave a bad key sitting in secure storage.
export async function unlockOnDevice(token: string, recoveryKey: string): Promise<void> {
  const keyset = await syncClient.getKeyset(token);
  const kek = deriveKEK(recoveryKey, keyset.kekSalt);
  const lmk = open(kek, keyset.lmkNonce, keyset.wrappedLmk); // throws on wrong key — nothing cached below
  await saveLMK(lmk);
}

// Epoch-based ISO-timestamp compare. `b === null` (no server `updated_at`
// recorded — shouldn't happen for an existing row, but defensive) sorts as
// "older than anything", so `a` (local) always wins in that case rather than
// throwing or silently no-op'ing.
//
// Compares by `Date.parse` (epoch ms), NOT lexically: `a` is a JS
// `toISOString()` value (`…123Z`, millisecond precision) while `b` can be a
// pydantic-serialized Postgres timestamptz (`…123456+00:00`, microsecond
// precision, `+00:00` offset instead of `Z`). Those two forms are NOT
// lexically comparable in the same second — e.g. `"...123Z"` sorts lexically
// AFTER `"...123456+00:00"` (`Z` > `4`) even though the latter is the same-or-
// later instant — so a lexical compare can pick the wrong winner. Parsing to
// epoch ms sidesteps both the `Z` vs `+00:00` spelling and the ms-vs-µs
// precision mismatch.
function isoCompare(a: string, b: string | null): number {
  if (b === null) return 1;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) {
    // Unparseable on either side — fall back to the previous lexical
    // compare rather than throwing or treating it as silently equal.
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return aMs < bMs ? -1 : aMs > bMs ? 1 : 0;
}

// The pure reconcile classification, lifted out of `syncNow`'s loop below so
// it can be (a) unit-tested branch-by-branch without any I/O and (b) reused
// read-only by `syncStatus` to answer "is there anything to sync" without
// touching the shadow, the LMK, or any book content. Same last-write-wins
// rule as before (see `syncNow`'s doc comment for the per-branch rationale):
// a plain id union of local/server can't tell "never synced" apart from
// "synced then locally deleted", which is exactly what `shadow` disambiguates.
// No I/O, no mutation of `shadow` — callers apply `shadowDrop` themselves.
export interface ReconcilePlan {
  toPush: string[];
  toPull: string[];
  toDeleteLocal: string[];
  toPushDelete: string[];
  shadowDrop: string[];
  // Live on both sides with equal timestamps (cmp === 0 in the local/server
  // "both live" branch) — nothing to transfer, but the ORIGINAL syncNow still
  // unconditionally `shadow.add(id)`'d in this case. Omitting these ids from
  // every list (as an earlier version of this plan did) silently drops them
  // from the shadow on an empty/lost-shadow resync; a later local delete of
  // that book then reads as "peer added" (shadow.has(id) === false) and
  // PULLS it back — resurrecting a book the user deleted. `equalKeep` is
  // NOT a pending change (syncStatus must not count it) — it exists purely
  // so `syncNow` can restore the shadow membership these ids always had.
  equalKeep: string[];
}

export function planReconcile(
  localIndex: { id: string; updatedAt: string }[],
  serverManifest: { bookId: string; clientVersion: string; deleted: boolean; updatedAt: string | null }[],
  shadow: Set<string>,
): ReconcilePlan {
  const serverById = new Map(serverManifest.map((b) => [b.bookId, b]));
  const localById = new Map(localIndex.map((m) => [m.id, m]));
  const allIds = new Set<string>([...serverById.keys(), ...localById.keys(), ...shadow]);

  const plan: ReconcilePlan = { toPush: [], toPull: [], toDeleteLocal: [], toPushDelete: [], shadowDrop: [], equalKeep: [] };

  for (const id of allIds) {
    const local = localById.get(id);
    const server = serverById.get(id);
    if (local && !server) {
      // Local present, nothing on the server — never synced.
      plan.toPush.push(id);
    } else if (local && server && !server.deleted) {
      // Both present and live — LWW against the version the last pusher
      // stamped (client_version), same as before this fix.
      const cmp = isoCompare(local.updatedAt, server.clientVersion);
      if (cmp > 0) plan.toPush.push(id);
      else if (cmp < 0) plan.toPull.push(id);
      else plan.equalKeep.push(id); // cmp === 0 → equal, nothing to transfer, but still shadow-live
    } else if (local && server && server.deleted) {
      // Both present, but the server side is a tombstone. Compare against
      // the tombstone's REAL timestamp (server.updatedAt, bumped by
      // DELETE) — not client_version, which a tombstone never updates — so
      // a live tombstone can't be mistaken for "equal, skip".
      if (isoCompare(local.updatedAt, server.updatedAt) <= 0) {
        // Delete wins (or it's a wash): the tombstone is at least as new as
        // our local copy — apply it locally.
        plan.toDeleteLocal.push(id);
      } else {
        // Local was edited after the tombstone — an intentional un-delete.
        // Push it, reviving the server row.
        plan.toPush.push(id);
      }
    } else if (!local && server && !server.deleted) {
      if (shadow.has(id)) {
        // We had this book, it's gone locally now, and the server still
        // thinks it's live — WE deleted it. Push the tombstone (the
        // previously-unused delete path).
        plan.toPushDelete.push(id);
      } else {
        // Genuinely new to this device — a peer added it.
        plan.toPull.push(id);
      }
    } else {
      // (!local && server && server.deleted) || (!local && !server) —
      // already gone on both sides, or only present in a stale shadow (e.g.
      // the server row was purged out from under us) — nothing to do,
      // just make sure the shadow agrees.
      plan.shadowDrop.push(id);
    }
  }

  return plan;
}

// ── EPUBs (ADR-014 increment 2 / 2.1) ───────────────────────────────────────
// Same LWW reconcile as books (`planReconcile`, keyed by `compiledAt` instead
// of `Book.updatedAt`), against its OWN shadow key (`EPUB_SHADOW_KEY`) so an
// epub id and a book id sharing the same value can't cross-contaminate. Both
// the epub bytes AND the small metadata blob (title/compiledAt) are sealed
// independently under a fresh per-epub data key (`dk`), which is itself
// wrapped under the device LMK — same "wrap a DK under the LMK" envelope
// shape `syncNow` uses for books.
//
// Platform-branched transport (Inc 2.1): a multi-MB epub must never buffer
// as a JS string/ArrayBuffer on native (Hermes has no JIT — @noble alone is
// too slow, and a base64 round-trip risks an OOM on a large device library),
// so native seals/opens the epub FILE-TO-FILE (`epubFileCrypto`'s
// `sealEpubFileNative`/`openEpubFileNative`, backed by
// `react-native-aes-gcm-crypto`) and streams the ciphertext straight to/from
// disk via `syncClient.putEpubFile`/`getEpubToFile` — the plaintext epub
// bytes never cross the JS bridge. Web has no such constraint and keeps the
// original in-memory `@noble` path (`epubCrypto`'s
// `sealEpubBytesWeb`/`openEpubBytesWeb` + `syncClient.putEpub`/`getEpub`).
// Both halves produce/consume the SAME wire shape — a (nonce, tag,
// ciphertext-without-tag) triple plus a small encrypted meta blob riding as
// headers (`EpubBlobHeaders`) — so an epub sealed on one platform opens on
// the other. The old body-framing module (a length-prefixed meta+epub octet
// stream) is gone: the meta ciphertext now rides as the `X-Meta`/`X-Meta-Nonce`
// headers alongside `X-Tag`, and the body is ciphertext-only.
export type EpubSkip = {
  id: string;
  title: string;
  sizeBytes: number;
  reason: "too_large" | "storage_full";
};

export interface EpubSyncResult {
  pushedEpubs: number;
  pulledEpubs: number;
  deletedEpubs: number;
  failed: string[];
  // A 413 (single-file or per-account cap) during a push — see the
  // `SyncResult.skipped` doc comment for why this is distinct from `failed`.
  skipped: EpubSkip[];
}

// The 413 detail lives in `ApiError.body` — FastAPI serializes an
// `HTTPException(413, detail=...)` as the raw JSON body `{"detail": "..."}`,
// and `syncClient`'s HTTP layer stashes that raw text on `ApiError.body`
// (NOT `.message`, which is always the generic `"API error 413"`). The
// backend raises exactly two distinct 413 details — `"epub too large"` (a
// single file over the per-file cap) and `"sync storage full"` (the
// per-account cap) — so a case-insensitive match on "storage" is enough to
// tell them apart without brittle exact-string coupling.
function skipReason(e: ApiError): "too_large" | "storage_full" {
  return /storage/i.test(e.body) ? "storage_full" : "too_large";
}

export async function syncEpubs(token: string, lmk: Uint8Array): Promise<EpubSyncResult> {
  const [localEpubs, serverEpubs, shadow] = await Promise.all([
    epubLibrary.listEpubs(),
    syncClient.listEpubs(token),
    loadEpubShadow(),
  ]);

  const localIndex = localEpubs.map((m) => ({ id: m.id, updatedAt: m.compiledAt }));
  const serverManifest = serverEpubs.map((e) => ({
    bookId: e.epubId,
    clientVersion: e.clientVersion,
    deleted: e.deleted,
    updatedAt: e.updatedAt,
  }));
  const plan = planReconcile(localIndex, serverManifest, shadow);

  let pushedEpubs = 0, pulledEpubs = 0, deletedEpubs = 0;
  const failed: string[] = [];
  const skipped: EpubSkip[] = [];

  for (const id of plan.shadowDrop) shadow.delete(id);
  for (const id of plan.equalKeep) shadow.add(id);

  const isWeb = Platform.OS === "web";
  // A per-run temp file name scoped by (kind, id) — cleaned up in `finally`
  // below regardless of success/failure. `cacheDirectory` (not
  // `documentDirectory`) because these are transient scratch files, not
  // library content.
  const tmp = (id: string, kind: string) => `${FileSystem.cacheDirectory}sync-${kind}-${id}.bin`;
  const metaBytes = (m: { title: string; compiledAt: string }) =>
    new TextEncoder().encode(JSON.stringify({ title: m.title, compiledAt: m.compiledAt }));

  // ── push one epub ──
  for (const id of plan.toPush) {
    const meta = localEpubs.find((m) => m.id === id);
    if (!meta) {
      failed.push(id);
      continue;
    }
    const dk = generateKey();
    const metaCt = seal(dk, metaBytes(meta));
    const wrappedDk = seal(lmk, dk);
    try {
      if (isWeb) {
        const raw = await epubLibrary.getEpubBytes(id);
        if (!raw) throw new Error(`local epub ${id} bytes vanished mid-sync`);
        const sealed = sealEpubBytesWeb(dk, new Uint8Array(raw));
        await syncClient.putEpub(token, id, sealed.ct, {
          nonce: sealed.nonce,
          tag: sealed.tag,
          metaCt: metaCt.ct,
          metaNonce: metaCt.nonce,
          wrappedDk: wrappedDk.ct,
          dkNonce: wrappedDk.nonce,
          clientVersion: meta.compiledAt,
        });
      } else {
        const ctUri = tmp(id, "ct");
        try {
          const sealed = await sealEpubFileNative(dk, epubLibrary.getEpubFileUri(id), ctUri);
          await syncClient.putEpubFile(token, id, ctUri, {
            nonce: sealed.nonce,
            tag: sealed.tag,
            metaCt: metaCt.ct,
            metaNonce: metaCt.nonce,
            wrappedDk: wrappedDk.ct,
            dkNonce: wrappedDk.nonce,
            clientVersion: meta.compiledAt,
          });
        } finally {
          await FileSystem.deleteAsync(ctUri, { idempotent: true }).catch(() => {});
        }
      }
      shadow.add(id);
      pushedEpubs++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) {
        // Deliberately NOT shadow.add()'d — this device never actually
        // synced it, so a future run (e.g. after the user frees space or the
        // cap is raised) retries the push instead of treating it as done.
        skipped.push({ id, title: meta.title, sizeBytes: meta.sizeBytes, reason: skipReason(e) });
      } else {
        failed.push(id);
      }
    }
  }

  // ── pull one epub ──
  for (const id of plan.toPull) {
    try {
      if (isWeb) {
        const { ct, headers } = await syncClient.getEpub(token, id);
        const dk = open(lmk, headers.dkNonce, headers.wrappedDk);
        const bytes = openEpubBytesWeb(dk, headers.nonce, headers.tag, ct);
        const meta = JSON.parse(
          new TextDecoder().decode(open(dk, headers.metaNonce, headers.metaCt)),
        ) as { title: string; compiledAt: string };
        // `.slice()` (not `.buffer` directly) guarantees a real ArrayBuffer
        // (not a SharedArrayBuffer-typed ArrayBufferLike) AND that it holds
        // exactly `bytes`'s span, regardless of what the underlying
        // allocation looked like.
        const arrayBuffer = bytes.slice().buffer as ArrayBuffer;
        // MUST pass compiledAt — `saveEpub` otherwise stamps `now()`, which
        // would make this pulled epub look locally-newer than the server on
        // the very next `planReconcile` and force an immediate re-push of
        // the (potentially tens-of-MB) file right back, ping-ponging
        // forever between any two devices that both have this epub.
        await epubLibrary.saveEpub({
          bookId: id,
          title: meta.title,
          bytes: arrayBuffer,
          compiledAt: meta.compiledAt,
        });
      } else {
        const ctUri = tmp(id, "ct");
        const plainUri = tmp(id, "plain");
        try {
          const { headers } = await syncClient.getEpubToFile(token, id, ctUri);
          const dk = open(lmk, headers.dkNonce, headers.wrappedDk);
          await openEpubFileNative(dk, headers.nonce, headers.tag, ctUri, plainUri);
          const meta = JSON.parse(
            new TextDecoder().decode(open(dk, headers.metaNonce, headers.metaCt)),
          ) as { title: string; compiledAt: string };
          // Same convergence rationale as the web branch above — thread the
          // server's compiledAt through `saveEpubFileNative`, never `now()`.
          await epubLibrary.saveEpubFileNative({
            bookId: id,
            title: meta.title,
            compiledAt: meta.compiledAt,
            plaintextUri: plainUri,
          });
        } finally {
          await FileSystem.deleteAsync(ctUri, { idempotent: true }).catch(() => {});
          // `plainUri` is MOVED into the library by `saveEpubFileNative` on
          // success (no bytes re-read into JS) — this delete is purely
          // defensive cleanup for the failure path, where it's still sitting
          // in the cache dir.
          await FileSystem.deleteAsync(plainUri, { idempotent: true }).catch(() => {});
        }
      }
      shadow.add(id);
      pulledEpubs++;
    } catch {
      failed.push(id);
    }
  }

  for (const id of plan.toDeleteLocal) {
    try {
      await epubLibrary.deleteEpub(id);
      shadow.delete(id);
      deletedEpubs++;
    } catch {
      failed.push(id);
    }
  }

  for (const id of plan.toPushDelete) {
    try {
      await syncClient.deleteEpub(token, id);
      shadow.delete(id);
      deletedEpubs++;
    } catch {
      failed.push(id);
    }
  }

  await saveEpubShadow(shadow);
  return { pushedEpubs, pulledEpubs, deletedEpubs, failed, skipped };
}

// ── Shelves (ADR-014 increment 2) ───────────────────────────────────────────
// A single-document LWW sync, same shape as a book but with no id path
// segment (one shelves doc per account) — the whole `{shelves, assignments}`
// state is one JSON blob, sealed under a fresh per-push data key wrapped by
// the LMK, and compared by `shelfStore`'s own doc clock
// (`exportShelvesDoc().updatedAt`) against the server's `client_version`.
//
// DELIBERATE DEVIATION from the brief's literal "server null → push"
// wording: when nothing has ever been synced (`server === null`) AND this
// device's doc is genuinely empty (no shelves, no assignments — e.g. a brand
// new install that has never organized anything), pushing is skipped. There
// is nothing to protect yet, and without this guard EVERY sync on a
// never-shelved device would re-push an empty doc (since a fresh `getShelves`
// keeps returning null until the first push lands), which is both wasted
// bandwidth and needlessly noisy for a status/pending count. A device with
// ANY real shelf/assignment state still pushes unconditionally when the
// server has nothing, matching the brief.
export interface ShelvesSyncResult {
  pushed: number; // 0 or 1
  pulled: number; // 0 or 1
  failed: string[]; // ["shelves"] on any error this run, else []
}

async function pushShelvesDoc(
  token: string,
  lmk: Uint8Array,
  local: { shelves: unknown; assignments: unknown; updatedAt: string },
): Promise<void> {
  const dk = generateKey();
  const docJson = JSON.stringify({ shelves: local.shelves, assignments: local.assignments });
  const docCt = seal(dk, new TextEncoder().encode(docJson));
  const wrappedDk = seal(lmk, dk);
  await syncClient.putShelves(token, {
    ciphertext: docCt.ct,
    nonce: docCt.nonce,
    wrappedDk: wrappedDk.ct,
    dkNonce: wrappedDk.nonce,
    clientVersion: local.updatedAt,
  });
}

export async function syncShelves(token: string, lmk: Uint8Array): Promise<ShelvesSyncResult> {
  try {
    const [local, server] = await Promise.all([shelfStore.exportShelvesDoc(), syncClient.getShelves(token)]);
    const isEmpty = local.shelves.length === 0 && Object.keys(local.assignments).length === 0;

    if (server === null) {
      if (isEmpty) return { pushed: 0, pulled: 0, failed: [] };
      await pushShelvesDoc(token, lmk, local);
      return { pushed: 1, pulled: 0, failed: [] };
    }

    const cmp = isoCompare(local.updatedAt, server.clientVersion);
    if (cmp > 0) {
      await pushShelvesDoc(token, lmk, local);
      return { pushed: 1, pulled: 0, failed: [] };
    }
    if (cmp < 0) {
      const dk = open(lmk, server.dkNonce, server.wrappedDk);
      const doc = JSON.parse(new TextDecoder().decode(open(dk, server.nonce, server.ciphertext))) as {
        shelves: Shelf[];
        assignments: Record<string, string>;
      };
      await shelfStore.importShelvesDoc({ shelves: doc.shelves, assignments: doc.assignments, updatedAt: server.clientVersion });
      return { pushed: 0, pulled: 1, failed: [] };
    }
    return { pushed: 0, pulled: 0, failed: [] };
  } catch {
    return { pushed: 0, pulled: 0, failed: ["shelves"] };
  }
}

// Reconcile the local library with the server by last-write-wins, per book
// id, using the persisted sync shadow (see `loadShadow`/`saveShadow` above)
// to disambiguate "never synced" from "synced then locally deleted". Requires
// an LMK cached on this device (`SyncLockedError` otherwise) — nothing is
// pushed, pulled, or even listed from the server without it. One book's
// failure (bad ciphertext, network blip, etc.) is caught and reported in
// `failed`; it never aborts the rest of the run. `deleted` counts BOTH a
// local delete applied (server tombstone won) and a local delete pushed to
// the server as a new tombstone (local delete won) — both are "a delete
// happened this run", just on different sides.
export async function syncNow(token: string): Promise<SyncResult> {
  const lmk = await loadLMK();
  if (!lmk) throw new SyncLockedError();

  const [serverBooks, localIndex, shadow] = await Promise.all([
    syncClient.listBooks(token),
    loadBookIndex(),
    loadShadow(),
  ]);

  let pushed = 0, pulled = 0, deleted = 0;
  const failed: string[] = [];

  const push = async (id: string) => {
    const book = await loadBook(id);
    if (!book) throw new Error(`local book ${id} vanished mid-sync`);
    const dk = generateKey();
    const enc = encryptBook(JSON.stringify(book), dk);
    const wrappedDk = seal(lmk, dk);
    await syncClient.putBook(token, id, {
      ciphertext: enc.ct,
      nonce: enc.nonce,
      wrappedDk: wrappedDk.ct,
      dkNonce: wrappedDk.nonce,
      clientVersion: book.updatedAt,
    });
    pushed++;
  };

  const pull = async (id: string) => {
    const remote = await syncClient.getBook(token, id);
    const dk = open(lmk, remote.dkNonce, remote.wrappedDk);
    const json = decryptBook(remote.nonce, remote.ciphertext, dk);
    const book = JSON.parse(json) as Book;
    await saveBook(book);
    pulled++;
  };

  const plan = planReconcile(localIndex, serverBooks, shadow);
  for (const id of plan.shadowDrop) shadow.delete(id);
  // Live-equal ids transfer nothing, but the original syncNow still
  // unconditionally shadow.add()'d them — restore that so an empty/lost
  // shadow doesn't misclassify a later local delete as "peer added" and
  // resurrect it. No I/O, no try/catch needed (Set.add can't throw).
  for (const id of plan.equalKeep) shadow.add(id);

  for (const id of plan.toPush) {
    try {
      await push(id);
      shadow.add(id);
    } catch {
      failed.push(id);
    }
  }
  for (const id of plan.toPull) {
    try {
      await pull(id);
      shadow.add(id);
    } catch {
      failed.push(id);
    }
  }
  for (const id of plan.toDeleteLocal) {
    try {
      await deleteLocalBook(id);
      shadow.delete(id);
      deleted++;
    } catch {
      failed.push(id);
    }
  }
  for (const id of plan.toPushDelete) {
    try {
      await syncClient.deleteBook(token, id);
      shadow.delete(id);
      deleted++;
    } catch {
      failed.push(id);
    }
  }

  await saveShadow(shadow);

  // EPUBs and shelves run AFTER the book reconcile above, still inside this
  // function body — `runSyncExclusive` wraps the whole `syncNow` call, so
  // folding them in here serializes them against every other caller for
  // free; no second mutex needed. Their counts merge into the same
  // pushed/pulled/deleted totals a caller already reads (books contribute no
  // `skipped` — that field only ever holds epub ids rejected by a 413 cap).
  const epubResult = await syncEpubs(token, lmk);
  const shelvesResult = await syncShelves(token, lmk);

  await AsyncStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
  return {
    pushed: pushed + epubResult.pushedEpubs + shelvesResult.pushed,
    pulled: pulled + epubResult.pulledEpubs + shelvesResult.pulled,
    deleted: deleted + epubResult.deletedEpubs,
    failed: [...failed, ...epubResult.failed, ...shelvesResult.failed],
    skipped: epubResult.skipped,
  };
}

// Serializes ALL `syncNow` callers (the auto-sync controller AND the manual
// "Sync now" button) so two `syncNow` bodies never overlap, regardless of
// which invoker started them. This matters because `syncNow` does a
// non-atomic `loadShadow -> mutate -> saveShadow` read-modify-write — two
// concurrent runs racing that can clobber each other's shadow writes and
// resurrect a book the user deleted locally (see the FIX 1 shadow tests
// above). A promise chain (not a boolean lock) is enough here because every
// caller goes through this one function — unlike autoSync's `pump()`, there
// is no "wanted" flag to coalesce; each call just waits its turn and runs.
let _syncChain: Promise<unknown> = Promise.resolve();
export function runSyncExclusive(token: string): Promise<SyncResult> {
  const run = _syncChain.then(() => syncNow(token), () => syncNow(token));
  _syncChain = run.then(() => undefined, () => undefined); // never reject the chain
  return run; // the caller still sees syncNow's real result/rejection
}

export async function getLastSyncedAt(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNCED_KEY);
}

// A cheap, read-only sibling of `syncNow` for a status badge/UI: "is there
// anything to sync" without doing any of the work. Reuses the same pure
// `planReconcile` classifier against a `listBooks` manifest fetch, so its
// notion of "pending" never drifts from what `syncNow` would actually do.
// Zero-knowledge by construction: only `listBooks` (id/version/deleted
// metadata) is fetched — never `getBook`, never a decrypt, never the shadow
// or local storage mutated. `lastSyncedAt` is attached in every branch
// (including `error`) so the UI can always show "last synced <time>" even
// when the live check itself failed.
export type SyncState = "up_to_date" | "pending" | "syncing" | "error" | "locked" | "signed_out";

export interface SyncStatus {
  state: SyncState;
  toPush: number;
  toPull: number;
  lastSyncedAt: string | null;
}

// EPUBs fold into the same `toPush`/`toPull` counts via the same
// `planReconcile` classifier `syncEpubs` uses (against `EPUB_SHADOW_KEY`), so
// this never drifts from what a real `syncNow` would do. Shelves contribute
// at most +1 either way — "does the local doc differ from the server's" —
// using the SAME empty-doc guard as `syncShelves` (a never-touched shelves
// doc against no server doc is "nothing to sync", not "+1 pending"), so the
// pending count here can never disagree with what `syncNow` would actually
// push. Only metadata crosses the wire (`listEpubs`, `getShelves` — the
// latter a small single blob per account, cheap even though it's a full GET,
// not a manifest) — no epub bytes, no book/epub content decrypt, nothing
// mutated. This does NOT force a full sync.
export async function syncStatus(token: string | null): Promise<SyncStatus> {
  const lastSyncedAt = await getLastSyncedAt();
  if (!token) return { state: "signed_out", toPush: 0, toPull: 0, lastSyncedAt };
  if (!(await isUnlocked())) return { state: "locked", toPush: 0, toPull: 0, lastSyncedAt };
  try {
    const [server, local, shadow, localEpubs, serverEpubs, epubShadow, localShelves, serverShelves] =
      await Promise.all([
        syncClient.listBooks(token),
        loadBookIndex(),
        loadShadow(),
        epubLibrary.listEpubs(),
        syncClient.listEpubs(token),
        loadEpubShadow(),
        shelfStore.exportShelvesDoc(),
        syncClient.getShelves(token),
      ]);

    const plan = planReconcile(local, server, shadow);
    let toPush = plan.toPush.length + plan.toPushDelete.length;
    let toPull = plan.toPull.length + plan.toDeleteLocal.length;

    const epubLocalIndex = localEpubs.map((m) => ({ id: m.id, updatedAt: m.compiledAt }));
    const epubServerManifest = serverEpubs.map((e) => ({
      bookId: e.epubId,
      clientVersion: e.clientVersion,
      deleted: e.deleted,
      updatedAt: e.updatedAt,
    }));
    const epubPlan = planReconcile(epubLocalIndex, epubServerManifest, epubShadow);
    toPush += epubPlan.toPush.length + epubPlan.toPushDelete.length;
    toPull += epubPlan.toPull.length + epubPlan.toDeleteLocal.length;

    const shelvesEmpty = localShelves.shelves.length === 0 && Object.keys(localShelves.assignments).length === 0;
    if (serverShelves === null) {
      if (!shelvesEmpty) toPush += 1;
    } else {
      const cmp = isoCompare(localShelves.updatedAt, serverShelves.clientVersion);
      if (cmp > 0) toPush += 1;
      else if (cmp < 0) toPull += 1;
    }

    return { state: toPush + toPull === 0 ? "up_to_date" : "pending", toPush, toPull, lastSyncedAt };
  } catch {
    return { state: "error", toPush: 0, toPull: 0, lastSyncedAt };
  }
}
