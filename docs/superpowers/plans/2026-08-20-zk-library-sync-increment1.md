# Zero-Knowledge Library Sync — Increment 1 (Book Sync MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zero-knowledge cross-device sync of authored **books** via a manual "Sync now": client envelope crypto + a backend encrypted-blob store + a reconcile engine + enable-sync/recovery-key UI.

**Architecture:** Client encrypts each book under a per-book Data Key wrapped by a per-user Library Master Key (LMK), itself wrapped by a KEK derived from a one-time recovery key (ADR-014 D10). The backend `sync/` module stores **ciphertext only**, scoped per user app-level by `account_id`. `syncNow()` reconciles local ↔ server by last-write-wins on `updatedAt`.

**Tech Stack:** RN+Expo, TypeScript, `@noble/ciphers` (AES-256-GCM) + `@noble/hashes` (PBKDF2) + `expo-crypto` (CSPRNG); FastAPI + asyncpg + alembic; Jest/RNTL + pytest.

**Spec:** `docs/superpowers/specs/2026-08-20-zk-library-sync-increment1-design.md` · **Crypto spike:** `reference_zero_knowledge_crypto_spike` (GO)

## Global Constraints

- **Zero-knowledge (ADR-014 O2) — non-negotiable.** The server must NEVER receive or store book plaintext, LMK, DK, KEK, or the recovery key. Only ciphertext + `wrapped_lmk`/`wrapped_dk` + `kek_salt` + nonces cross the wire / land in Postgres. A test greps outbound payloads to assert this.
- **Crypto stack (spike-proven):** `@noble/ciphers` `gcm` (AES-256-GCM AEAD), `@noble/hashes` `pbkdf2`(sha256, 100k), all random via `expo-crypto` `getRandomBytes` (a real CSPRNG — NOT `@/lib/uuid`'s Math.random). Pure-JS, Hermes+web, no native module.
- **App-level isolation, not RLS** (backend rule #4): every `sync/` query `WHERE owner_account_id = $account`, where `account` is resolved from the verified `Principal.sub` via `accounts_repo.get_account(conn, idp_sub=principal.sub)`. Ciphertext-only storage makes a scoping bug leak only ciphertext.
- **Recovery key shown exactly once** at setup; never persisted server-side (only its PBKDF2-wrapped LMK), never logged, never re-rendered.
- **LMK cached device-local** via the secure-store abstraction (`expo-secure-store` native / the existing web fallback keyStore uses) — never in AsyncStorage/IndexedDB/localStorage-in-clear on native.
- **No `backend/__init__.py`** at the top level; package `__init__.py` under `backend/src/sync/` like siblings.
- **Manual sync only** (Increment 1); no auto-triggers. **Books only**; no EPUBs/shelves/keys.
- **Help DoD:** a `library-sync` FEATURES key + topic + tree leaf.
- Backend needs a refresh + migration `0024` at deploy; feature is opt-in (off until enabled).

## File Structure

- **Create:** `mobile/src/crypto/envelope.ts` (+ test); `mobile/src/sync/syncClient.ts`, `mobile/src/sync/lmkStore.ts`, `mobile/src/sync/syncEngine.ts` (+ tests); `mobile/src/components/LibrarySync.tsx` (+ test); `backend/src/sync/__init__.py`, `repo.py`, `router.py`, `schemas.py`; `backend/alembic/versions/0024_sync_keyset_and_book.py`; `backend/tests/test_sync.py`.
- **Modify:** `mobile/app/(tabs)/settings.tsx` (mount `<LibrarySync/>`); `backend/main.py` (include the sync router); `mobile/src/api/client.ts` (an auth'd `apiFetch` helper if not present); Help content files; `mobile/package.json` (`@noble/ciphers`, `@noble/hashes`).

---

## Task 1: Crypto envelope module (`mobile/src/crypto/envelope.ts`)

**Files:** Create `mobile/src/crypto/envelope.ts`, `mobile/__tests__/crypto/envelope.test.ts`. Modify `mobile/package.json`.

**Interfaces:**
- Produces: `generateRecoveryKey(): string`; `generateKey(): Uint8Array` (32B); `deriveKEK(recoveryKey: string, salt: Uint8Array): Uint8Array`; `seal(key, bytes)→{nonce,ct}`; `open(key, nonce, ct)→Uint8Array` (throws on tamper); `encryptBook(bookJson: string, dk: Uint8Array)`/`decryptBook(...)`; `randomSalt()`, `randomNonce()`.

- [ ] **Step 1: Add deps** — `cd mobile && npm i @noble/ciphers@^1 @noble/hashes@^1` (pure-JS; commit the lockfile change).

- [ ] **Step 2: Write the failing tests**

```ts
// mobile/__tests__/crypto/envelope.test.ts
import { generateRecoveryKey, generateKey, deriveKEK, seal, open, randomSalt } from "@/crypto/envelope";
const enc = new TextEncoder(), dec = new TextDecoder();

it("seal/open round-trips and detects tampering (AEAD)", () => {
  const k = generateKey();
  const { nonce, ct } = seal(k, enc.encode("hello world"));
  expect(dec.decode(open(k, nonce, ct))).toBe("hello world");
  const bad = Uint8Array.from(ct); bad[0] ^= 1;
  expect(() => open(k, nonce, bad)).toThrow();
});

it("recovery key → KEK is deterministic (same key+salt), and a wrong key can't unwrap", () => {
  const rk = generateRecoveryKey(); const salt = randomSalt();
  const kek1 = deriveKEK(rk, salt); const kek2 = deriveKEK(rk, salt);
  expect(Buffer.from(kek1)).toEqual(Buffer.from(kek2));
  const lmk = generateKey(); const wrapped = seal(kek1, lmk);
  expect(Buffer.from(open(deriveKEK(rk, salt), wrapped.nonce, wrapped.ct))).toEqual(Buffer.from(lmk));
  expect(() => open(deriveKEK(generateRecoveryKey(), salt), wrapped.nonce, wrapped.ct)).toThrow();
});

it("full envelope: recovery→KEK→LMK→DK→book round-trips", () => {
  const rk = generateRecoveryKey(), salt = randomSalt();
  const kek = deriveKEK(rk, salt), lmk = generateKey(), dk = generateKey();
  const wLmk = seal(kek, lmk), wDk = seal(lmk, dk);
  const book = JSON.stringify({ id: "b1", updatedAt: "2026-01-01" });
  const encBook = seal(dk, enc.encode(book));
  const lmk2 = open(deriveKEK(rk, salt), wLmk.nonce, wLmk.ct);
  const dk2 = open(lmk2, wDk.nonce, wDk.ct);
  expect(dec.decode(open(dk2, encBook.nonce, encBook.ct))).toBe(book);
});
```

- [ ] **Step 3: Run, verify failure.**

- [ ] **Step 4: Implement** `mobile/src/crypto/envelope.ts` (mirror the spike):

```ts
import { gcm } from "@noble/ciphers/aes";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import * as Crypto from "expo-crypto";

// All key/nonce/salt material comes from expo-crypto's CSPRNG (real randomness on
// web AND Hermes — verified in largeSecureStore.ts). NEVER Math.random here.
export function randomBytes(n: number): Uint8Array { return Crypto.getRandomBytes(n); }
export function randomNonce(): Uint8Array { return randomBytes(12); }   // GCM 96-bit nonce
export function randomSalt(): Uint8Array { return randomBytes(16); }
export function generateKey(): Uint8Array { return randomBytes(32); }   // AES-256 key

// Recovery key: 32 bytes of entropy → base32-ish groups the user copies once.
const B32 = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
export function generateRecoveryKey(): string {
  const b = randomBytes(20);
  let s = "";
  for (let i = 0; i < b.length; i++) { s += B32[b[i] % B32.length]; if (i % 4 === 3 && i < b.length - 1) s += "-"; }
  return s; // e.g. "k7m2-9ab3-..." — high-entropy, human-copyable
}

export function deriveKEK(recoveryKey: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(recoveryKey), salt, { c: 100_000, dkLen: 32 });
}

export function seal(key: Uint8Array, bytes: Uint8Array): { nonce: Uint8Array; ct: Uint8Array } {
  const nonce = randomNonce();
  return { nonce, ct: gcm(key, nonce).encrypt(bytes) };
}
export function open(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array): Uint8Array {
  return gcm(key, nonce).decrypt(ct); // throws on auth failure (tamper / wrong key)
}

const enc = new TextEncoder(), dec = new TextDecoder();
export function encryptBook(bookJson: string, dk: Uint8Array) { return seal(dk, enc.encode(bookJson)); }
export function decryptBook(nonce: Uint8Array, ct: Uint8Array, dk: Uint8Array): string { return dec.decode(open(dk, nonce, ct)); }
```
Mock `expo-crypto` in the test env (`Crypto.getRandomBytes` → a deterministic-enough buffer, or the real node crypto). Confirm `@noble/ciphers/aes` + `@noble/hashes/pbkdf2` import paths against the installed v1 (adjust if the subpath differs).

- [ ] **Step 5: Run, verify pass** — `cd mobile && npx jest envelope && npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git commit -m "feat(crypto): envelope module — AES-256-GCM + PBKDF2 recovery-key (ADR-014 D10)"`

---

## Task 2: Backend `sync/` module + migration 0024

**Files:** Create `backend/src/sync/{__init__.py,repo.py,router.py,schemas.py}`, `backend/alembic/versions/0024_sync_keyset_and_book.py`, `backend/tests/test_sync.py`. Modify `backend/main.py` (include router).

**Interfaces:**
- Endpoints under `/api/v1/sync/*`, all `Depends(require_active_user)` → account via `accounts_repo.get_account(conn, idp_sub=principal.sub)`.
- Produces: keyset get/put; book list/get/put/delete — **opaque ciphertext** (base64 in JSON), never interpreted.

- [ ] **Step 1: Write the migration** `0024_sync_keyset_and_book.py` (mirror `0023_project_rights.py`'s alembic shape; `down_revision = "0023"`):
  - `sync_keyset(owner_account_id uuid PK REFERENCES account(id) ON DELETE CASCADE, wrapped_lmk bytea NOT NULL, lmk_nonce bytea NOT NULL, kek_salt bytea NOT NULL, created_at timestamptz DEFAULT now())`.
  - `synced_book(owner_account_id uuid REFERENCES account(id) ON DELETE CASCADE, book_id text NOT NULL, ciphertext bytea NOT NULL, nonce bytea NOT NULL, wrapped_dk bytea NOT NULL, dk_nonce bytea NOT NULL, client_version text NOT NULL, deleted bool NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now(), PRIMARY KEY (owner_account_id, book_id))`.
  (Confirm the `account` PK type by reading `account`'s migration; match it.)

- [ ] **Step 2: Write the failing tests** `backend/tests/test_sync.py` (mirror an existing async-DB test — e.g. `test_library.py`/trust tests — for the app + auth-header fixtures):
  - `PUT /sync/keyset` then `GET /sync/keyset` returns the same base64 fields; a 2nd `PUT` without `force` → 409 (refuse overwrite).
  - `PUT /sync/books/b1` (ciphertext) then `GET` returns byte-identical ciphertext + `client_version`; `GET /sync/books` lists `b1`; `DELETE /sync/books/b1` → `GET /sync/books` shows `deleted:true`.
  - **Isolation:** account B's token cannot `GET`/`PUT` account A's `book_id`/keyset (returns empty/404 for B, never A's bytes).
  - A `>20MB` ciphertext → 413.
  - No ciphertext/keys appear in any log (assert the redaction/structlog capture is clean).

- [ ] **Step 3: Implement**
  - `schemas.py`: pydantic models — `Keyset{wrapped_lmk,lmk_nonce,kek_salt}` (base64 str), `BookBlob{ciphertext,nonce,wrapped_dk,dk_nonce,client_version}`, `BookMeta{book_id,client_version,deleted,updated_at}`. base64 encode/decode at the boundary.
  - `repo.py` (asyncpg, all scoped by `owner_account_id`): `get_keyset`, `upsert_keyset(force)`, `list_books`, `get_book`, `upsert_book`, `tombstone_book`. Bytea in/out.
  - `router.py`: the endpoints from the spec; resolve account (`accounts_repo.get_account`), 404 when account/DB absent, size guard, `enforce_rate_limit`. `PUT /sync/keyset` 409 if a keyset exists and `force` is falsy. Never log ciphertext/keys (use the redaction logger).
  - `main.py`: `app.include_router(sync_router, prefix="/api/v1")` (match how other routers are mounted).

- [ ] **Step 4: Run, verify pass** — `cd backend && python3 -m pytest tests/test_sync.py -q` (from repo root, `backend/.venv`); `ruff check` the new files.
- [ ] **Step 5: Commit** — `git commit -m "feat(sync): backend zero-knowledge blob store — keyset + synced_book (migration 0024, app-level isolation)"`

---

## Task 3: Sync engine (client)

**Files:** Create `mobile/src/sync/syncClient.ts`, `mobile/src/sync/lmkStore.ts`, `mobile/src/sync/syncEngine.ts`, tests. Maybe modify `mobile/src/api/client.ts` (auth'd fetch helper).

**Interfaces:**
- `syncClient`: `getKeyset()`, `putKeyset(k, force?)`, `listBooks()`, `getBook(id)`, `putBook(id, blob)`, `deleteBook(id)` — auth'd (Bearer `accessToken`) calls to `/sync/*`, base64 ⇄ Uint8Array at the boundary.
- `lmkStore`: `saveLMK(bytes)`, `loadLMK()`, `clearLMK()` — the device-local LMK cache (secure-store native / web fallback, mirror `keyStore`'s platform split).
- `syncEngine`: `enableSync(recoveryKey?)` (generate/set keyset + cache LMK), `unlockOnDevice(recoveryKey)` (fetch keyset → deriveKEK → unwrap LMK → cache), `syncNow()` → `{pushed,pulled,deleted}`.

- [ ] **Step 1: Write the failing tests** (mock `syncClient`, `envelope`, `bookStore`, `lmkStore`)
  - `syncNow`: local-newer book → `putBook` called with ciphertext (assert the PUT body has NO plaintext title/content — grep the payload); server-newer → `getBook`+`decryptBook`+`saveBook`; server tombstone → `deleteBook` local; equal → neither.
  - a single book's `decryptBook` throwing → caught, that id reported as failed, others still sync.
  - `unlockOnDevice(wrongKey)` → keyset unwrap throws → surfaced as an error, LMK not cached.
  - **no-plaintext-leaves:** across a full `syncNow`, assert every `putBook` body is ciphertext (no book title/content substring).

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement**
  - `syncClient.ts`: use `useAuth().accessToken` (passed in or via a getter) as `Authorization: Bearer`; `${BASE_URL}/api/v1/sync/...`; base64 the byte fields. (Add an `authedFetch` in `api/client.ts` if none exists — see `publishBook`'s Bearer pattern.)
  - `lmkStore.ts`: native → `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); web → the same fallback `keyStore` uses for the BYOK key. Store the LMK hex/base64.
  - `syncEngine.ts`:
    - `enableSync()`: `generateRecoveryKey()`; `generateKey()`→LMK; `randomSalt()`; `deriveKEK(rk,salt)`; `seal(kek,LMK)`→wrapped; `putKeyset({wrapped_lmk,lmk_nonce,kek_salt})`; `saveLMK(LMK)`; return the recovery key (caller shows it once). If a keyset already exists, do NOT overwrite (server 409) — go to unlock instead.
    - `unlockOnDevice(rk)`: `getKeyset()`; `deriveKEK(rk, salt)`; `open(kek, lmk_nonce, wrapped_lmk)`→LMK (throws if wrong key); `saveLMK(LMK)`.
    - `syncNow()`: require LMK (`loadLMK`); `listBooks()` (server) + `loadBookIndex()` (local) → union by id; per id LWW by `updatedAt` vs `client_version`:
      - push: `loadBook(id)` → `dk=generateKey()` → `encryptBook` → `wrap dk under LMK` → `putBook(id, {ciphertext,nonce,wrapped_dk,dk_nonce,client_version:book.updatedAt})`.
      - pull: `getBook(id)` → unwrap dk (LMK) → `decryptBook` → `saveBook`.
      - tombstone newer → `deleteBook(id)` local.
    - per-book try/catch → collect failures; return counts.

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest sync && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(sync): client engine — envelope encrypt/decrypt + manual syncNow (LWW), LMK device-cached"`

---

## Task 4: Settings "Sync" UI

**Files:** Create `mobile/src/components/LibrarySync.tsx`, test. Modify `mobile/app/(tabs)/settings.tsx`.

- [ ] **Step 1: Write the failing tests** (RNTL; mock `syncEngine`)
  - not-enabled → "Enable cloud sync" → calls `enableSync`, renders the recovery key **once** with a copy + "I saved it" confirm.
  - enabled + LMK present → "Sync now" → calls `syncNow`, shows counts.
  - enabled + no LMK (new device) → recovery-key input → `unlockOnDevice` → then Sync.
  - the recovery key is NOT rendered outside the enable-setup screen.

- [ ] **Step 2–4: Implement + mount** a `<LibrarySync/>` Settings section mirroring `BackupRestore.tsx`'s structure (busy-guard, `@/lib/alert`, section styling). States: not-enabled / enabled-unlocked / enabled-locked. Recovery-key display is one-time (`generateRecoveryKey` result, shown until confirmed, copy button, warning that it's the ONLY way to unlock a new device and the exported EPUB/PDF is the fallback — ADR-014 O4). Mount under Settings (near BackupRestore), gated where Settings is. Run `npx jest LibrarySync && npx tsc --noEmit` + the full `npx jest` (settings-mount guard). Commit.

---

## Task 5: Help topic + tree leaf

**Files:** Modify `mobile/src/help-content/{features.ts,topics.ts,tree.ts}`. Copy a sibling (e.g. `backup-restore`).

- [ ] Add `library-sync` FEATURES key + a topic (`featureKey:"library-sync"`): cloud sync keeps your library on your devices; it's **end-to-end encrypted — we can't read your books**; you get a **recovery key at setup — save it, it's the only way to unlock a new device** (the exported EPUB/PDF is your fallback); Increment-1 caveats accurate (manual "Sync now", **books only** for now, API key is separate). NO cloud-can-read claim. Add the tree leaf (node id distinct from topicId). `npx jest --testPathPattern=help`. Commit `docs(help): library-sync topic + tree leaf`.

---

## Self-Review

- **Spec coverage:** crypto D10 → T1; backend blob store + migration + isolation → T2; manual syncNow LWW + LMK cache + recovery unlock → T3; enable/unlock/recovery-key UI → T4; Help → T5. Zero-knowledge invariant enforced in T1 (crypto), T2 (ciphertext-only + isolation test), T3 (no-plaintext-leaves test). Device-verify (@noble Hermes) is a post-merge step, not a task.
- **Type consistency:** `seal/open`, `deriveKEK`, `generateKey/RecoveryKey` (T1) consumed by `syncEngine` (T3); `syncClient` fields (base64) ⇄ backend `schemas` (T2). `client_version` = `book.updatedAt` throughout.
- **Placeholder scan:** two locate-don't-invent notes — the `@noble` v1 import subpaths (T1) and the `account` PK type / router-mount style (T2). No fabricated APIs.
- **Risk notes:** (1) `@noble` on Hermes perf — the device-verify settles it (spike proved the JS logic). (2) web LMK "secure" store is only as strong as web storage (no OS keystore on web) — acceptable + matches how the BYOK key is already handled on web; note it in T3. (3) two devices syncing concurrently could clobber via LWW — acceptable for manual Increment 1; Increment 1b/4 refine.
