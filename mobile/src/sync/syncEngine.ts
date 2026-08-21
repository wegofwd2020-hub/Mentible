// The zero-knowledge library sync engine (ADR-014 increment 1). Not a React
// component/hook — the caller (Settings UI, T4) passes the session access
// token in explicitly on every call. This is the only module that wires the
// crypto envelope (`crypto/envelope.ts`), the LMK device cache
// (`sync/lmkStore.ts`), the sync wire client (`sync/syncClient.ts`), and local
// book storage (`storage/bookStore.ts`) together. The LMK is decrypted only
// in memory here (and inside `envelope.ts`) — it is never logged, and the
// only place it is persisted is `lmkStore`'s device-local secure cache.
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
import * as syncClient from "@/sync/syncClient";
import { ApiError } from "@/api/client";
import { saveLMK, loadLMK } from "@/sync/lmkStore";
import { loadBookIndex, loadBook, saveBook, deleteBook as deleteLocalBook } from "@/storage/bookStore";

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

async function loadShadow(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SHADOW_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function saveShadow(shadow: Set<string>): Promise<void> {
  await AsyncStorage.setItem(SHADOW_KEY, JSON.stringify([...shadow]));
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
  await AsyncStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
  return { pushed, pulled, deleted, failed };
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

export async function syncStatus(token: string | null): Promise<SyncStatus> {
  const lastSyncedAt = await getLastSyncedAt();
  if (!token) return { state: "signed_out", toPush: 0, toPull: 0, lastSyncedAt };
  if (!(await isUnlocked())) return { state: "locked", toPush: 0, toPull: 0, lastSyncedAt };
  try {
    const [server, local, shadow] = await Promise.all([
      syncClient.listBooks(token),
      loadBookIndex(),
      loadShadow(),
    ]);
    const plan = planReconcile(local, server, shadow);
    const toPush = plan.toPush.length + plan.toPushDelete.length;
    const toPull = plan.toPull.length + plan.toDeleteLocal.length;
    return { state: toPush + toPull === 0 ? "up_to_date" : "pending", toPush, toPull, lastSyncedAt };
  } catch {
    return { state: "error", toPush: 0, toPull: 0, lastSyncedAt };
  }
}
