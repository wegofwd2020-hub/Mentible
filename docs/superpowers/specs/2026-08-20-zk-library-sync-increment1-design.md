# Zero-Knowledge Library Sync — Increment 1 (Book Sync MVP) — Design Spec

**Status:** Proposed · **Date:** 2026-08-20 · **Area:** `mobile/src/crypto`, `mobile/src/sync`, `mobile/app/(tabs)/settings.tsx`, `backend/src/sync`, `backend/alembic` · **Builds:** ADR-014 (ticket #4 — deferred zero-knowledge library sync) · **Spike:** `reference_zero_knowledge_crypto_spike` (crypto-parity GO)

## Why

The library is per-origin, per-device browser storage with no server copy ([[reference_web_library_storage_and_migration]]) — every user loses their library on an origin/device move, and an admin can't bulk-migrate it (it's never on the server). ADR-014 already decided the fix: **zero-knowledge cloud sync** (O2, locked) with **per-user envelope encryption** (D10). This increment builds the **foundation + book sync**: the client crypto, a backend encrypted-blob store, and a manual "Sync now" that pushes/pulls **authored books**. It ends the migration pain permanently for books and lays the crypto+backend rails that increments 2–4 (EPUBs, key sync, recovery flows) extend.

**Zero-knowledge is non-negotiable (ADR-014 O2):** the server stores **ciphertext only** and can never read library content, the LMK/DK, or the recovery key. Plaintext sync was explicitly rejected.

## Scope (Increment 1)

- **In:** client crypto module; a manual **"Sync now"** (encrypt local authored books → push; pull server books → decrypt → merge by last-write-wins); enable-sync + recovery-key UI; backend `sync/` module (per-user encrypted-blob store + keyset, migration `0024`, endpoints); device-verify `@noble` on Hermes.
- **Deferred (later increments):** automatic sync on-sign-in/on-change (Increment 1b — a refinement over the manual engine); reader EPUBs + shelves (Increment 2); zero-knowledge **key** sync (Increment 3); recovery flows / re-key / conflict-copy UX (Increment 4); sharing stays export-artifact (D11, shipped).

## Crypto model (ADR-014 D10 envelope; spike-proven)

Stack: **`@noble/ciphers`** (AES-256-GCM, AEAD) + **`@noble/hashes`** (PBKDF2-SHA256) + **`expo-crypto`** (`getRandomBytes`, the CSPRNG — already installed, already cross-platform in `largeSecureStore.ts`). Pure-JS, Hermes+web, **no native module**.

```
recovery key (random, shown once) ──PBKDF2(salt,100k)──▶ KEK ──AES-GCM wrap──▶ LMK (per-user, random 32B)
LMK ──AES-GCM wrap──▶ DK (per-book, random 32B) ──AES-GCM encrypt──▶ book JSON
```

- **Setup (enable sync):** generate a random **recovery key** (high-entropy, e.g. 32 bytes → base32 groups) shown **once**; generate a random **LMK**; derive **KEK** = PBKDF2(recoveryKey, random salt); wrap LMK under KEK → upload `{wrapped_lmk, lmk_nonce, kek_salt}` (the **keyset**). Cache the LMK locally in **expo-secure-store** (device-local) so we don't re-derive per operation.
- **New device (sync already enabled server-side, no local LMK):** user enters the recovery key once → derive KEK from the server's `kek_salt` → unwrap the server `wrapped_lmk` → cache LMK locally. (Recovery key entered once per new device — the "unlock sync here" step.)
- **Per book:** generate a fresh **DK**; encrypt the book JSON with DK (AES-GCM, fresh nonce); wrap DK under the LMK. Upload `{ciphertext, nonce, wrapped_dk, dk_nonce, version}`.
- **Never** logged / never sent in plaintext: recovery key, KEK, LMK, DK, book plaintext. The server only ever holds ciphertext + wrapped keys + salt.

`mobile/src/crypto/envelope.ts`: `generateRecoveryKey()`, `deriveKEK(recoveryKey, salt)`, `generateKey()` (LMK/DK, 32B), `seal(key, bytes)→{nonce,ct}`, `open(key, nonce, ct)→bytes` (throws on tamper — AEAD), `encryptBook(book, dk)`, `decryptBook(ct, nonce, dk)`. All bytes via `expo-crypto`. Unit-tested for round-trip + tamper-throw + recovery-key determinism.

## Backend (`backend/src/sync/`, migration `0024`, app-level isolation by `account_id`)

**Isolation = the established app-level pattern** (accounts/trust): resolve `account_id` from the verified `Principal.sub` (`accounts` dep), scope every query `WHERE owner_account_id = $account`. **NOT Postgres RLS** (backend rule #4) — and because the server stores **ciphertext only**, a scoping bug leaks only ciphertext (defense in depth). ADR-014 O1's "Supabase RLS" is reconciled to app-level-guard here, consistent with the whole backend.

**Migration `0024_sync_keyset_and_book`:**
- `sync_keyset`: `owner_account_id` (PK, FK account), `wrapped_lmk bytea`, `lmk_nonce bytea`, `kek_salt bytea`, `created_at`. One row per user; set on enable-sync, read on new-device unlock.
- `synced_book`: `owner_account_id`, `book_id text` (the client's book id), `ciphertext bytea`, `nonce bytea`, `wrapped_dk bytea`, `dk_nonce bytea`, `client_version text` (the book's `updatedAt` ISO — the LWW comparator), `deleted bool default false` (tombstone), `updated_at`. PK `(owner_account_id, book_id)`.

**Router `/api/v1/sync/*`** (`Depends(require_user)` → account via accounts dep):
- `GET /sync/keyset` → `{wrapped_lmk, lmk_nonce, kek_salt}` or `404`/`null` if sync not enabled.
- `PUT /sync/keyset` → body `{wrapped_lmk, lmk_nonce, kek_salt}`; upsert (enable sync). **Refuse to overwrite an existing keyset unless a `force` re-key flag is set** (overwriting the keyset orphans all existing ciphertext — guard it; re-key is Increment 4).
- `GET /sync/books` → `[{book_id, client_version, deleted, updated_at}]` (metadata only, no ciphertext) — the reconcile manifest.
- `GET /sync/books/{book_id}` → `{ciphertext, nonce, wrapped_dk, dk_nonce, client_version}` (base64 fields over JSON).
- `PUT /sync/books/{book_id}` → upsert the encrypted blob + `client_version`; server does **not** interpret content (opaque bytes). Last-write-wins is resolved **client-side** by `client_version`; server just stores what's PUT (Increment 1 keeps the server dumb — a blob store).
- `DELETE /sync/books/{book_id}` → set `deleted=true` (tombstone; keeps LWW coherent).
- Size guard (a max blob size, e.g. 20 MB) + rate limiting via the existing limiter. Never log ciphertext/keys.

`backend/src/sync/`: `repo.py` (asyncpg queries, all scoped by account), `router.py`, `schemas.py`. No `__init__.py` at `backend/` top level (repo rule); package `__init__.py` under `src/sync/` as siblings do.

## Sync engine (client, `mobile/src/sync/`) — manual "Sync now"

`syncNow()` (called by the Settings "Sync now" button; auto-triggers are Increment 1b):
1. Ensure LMK is available (else prompt recovery-key unlock, or enable-sync if no keyset).
2. `GET /sync/books` → server manifest. `loadBookIndex()` → local. Build the union by `book_id`.
3. For each id: compare local `updatedAt` vs server `client_version` (LWW):
   - local-only or local newer → `encryptBook` (fresh DK) → `PUT /sync/books/{id}`.
   - server-only or server newer → `GET` → `decryptBook` → `saveBook`.
   - equal → skip. tombstone (server `deleted`) newer than local → `deleteBook` locally.
4. Report `{pushed, pulled, deleted}` + last-synced timestamp (persisted locally).
Encryption/decryption is per-book; a single book's failure is caught + reported, never aborts the run (mirror bookBundle's per-entry discipline). The LMK never leaves the device; only ciphertext + wrapped DK go over the wire.

Uses `useAuth().accessToken` (Bearer) via the existing API client. `client_version` = the book's `updatedAt`.

## UI (Settings → "Sync" section)

- **Not enabled:** "Enable cloud sync" → generate + **display the recovery key ONCE** (copy button; a "I've saved it" confirm + a re-show-once warning) → set keyset → run first `syncNow()`. Copy: your books are encrypted on your device; we can't read them; **without the recovery key a new device can't unlock the sync** (the exported EPUB/PDF is your standing fallback — ADR-014 O4).
- **Enabled, LMK on this device:** "Sync now" button + last-synced + a syncing indicator + result counts.
- **Enabled, no LMK on this device (new device):** "Enter your recovery key to unlock sync on this device" field → unlock → cache LMK → sync.
- Errors via `@/lib/alert`. Never render the recovery key except at the one-time setup screen.

## Security invariants (tested)

- Server never receives or stores: book plaintext, LMK, DK, KEK, recovery key. Only ciphertext + `wrapped_lmk`/`wrapped_dk` + `kek_salt` + nonces.
- Recovery key is shown exactly once, never persisted server-side (only its PBKDF2-wrapped LMK), never logged (ADR-001-style discipline extends to sync secrets).
- LMK cached in `expo-secure-store` (device-local, OS-keystore-backed), never in AsyncStorage/IndexedDB/localStorage.
- AEAD: any tampered ciphertext fails to decrypt (throws), surfaced as a per-book sync error, never silently accepted.
- A `PUT /sync/keyset` over an existing keyset is refused without `force` (prevents orphaning all ciphertext).

## Non-goals (Increment 1)

- No automatic sync (on-sign-in/on-change) — manual "Sync now" only (Increment 1b).
- No reader-EPUB / shelves / key sync (Increments 2–3).
- No conflict-copy / merge UI — last-write-wins by `updatedAt` (Increment 4 refines).
- No re-key / lost-recovery-key recovery flow beyond "export artifact is your fallback" (Increment 4).
- No server-side content features (search/render) — impossible by design (ciphertext).
- No sharing changes (D11 export-artifact, shipped).

## Testing

- **Crypto (`envelope.ts`):** round-trip (encrypt→decrypt equal), tamper→throw (AEAD), recovery-key determinism (same key+salt→same KEK→unwraps LMK), a new random recovery key does NOT unwrap. Web (jsdom) + native (the `@noble`/`expo-crypto` mocks) — and the **device-verify** (§below) proves Hermes.
- **Backend (`sync/`):** keyset upsert + refuse-overwrite-without-force; book PUT/GET/DELETE round-trip (opaque bytes preserved byte-for-byte); **isolation** — account A cannot read/write account B's `synced_book`/`sync_keyset` (guard by account, not RLS); size guard; no ciphertext/keys in logs. `pytest` + fakeredis + a test DB (or the repo's async DB test pattern).
- **Sync engine:** `syncNow` pushes local-newer, pulls server-newer, deletes on tombstone, skips equal, reports counts; a single book decrypt failure is caught + continues; no LMK → prompts unlock (no plaintext leaves).
- **UI:** enable-sync shows the recovery key once + sets keyset + syncs; new-device unlock path; "Sync now" reports counts; recovery key never rendered outside setup.
- **★ Device-verify (native, per `mobile:verify`):** on the emulator, encrypt+decrypt a ~1 MB book with `@noble` on Hermes (perf + correctness — the one spike risk), then enable sync on one instance and unlock+sync on a fresh install to confirm end-to-end cross-device.
- **Security assertion tests:** grep the built request payloads / logs in tests to assert no plaintext/recovery-key/LMK leaves the device.

## Rollout

Backend (`sync/` + migration `0024`) needs a **backend refresh** (ROOT runbook) + web deploy + APK. The `synced_book`/`sync_keyset` tables are additive; the feature is opt-in (off until a user enables sync). Old clients ignore it. First real use: enable sync on the old device, unlock+sync on mentible.app → books flow zero-knowledge, no console. Then Increment 2 adds EPUBs.
