# ZK Sync Increment 2 (Reader EPUBs + Shelves) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync reader EPUBs (large binary) and shelves zero-knowledge, on the Increment-1/1b rails.

**Architecture:** New backend `synced_epub` (octet-stream, framed `[meta|epub]` body) + `synced_shelves` (JSON) tables (migration 0025), ciphertext-only, app-level isolation. Client reuses the envelope crypto + `planReconcile` + the `runSyncExclusive` mutex + auto-sync; adds `syncEpubs` + `syncShelves` folded into `syncNow`. Per-file 50 MB + per-user total soft cap; nginx body limit 25→60 MB.

**Tech Stack:** RN+Expo, TypeScript, `@noble` AES-GCM + expo-crypto, FastAPI + asyncpg + alembic, nginx.

**Spec:** `docs/superpowers/specs/2026-08-21-zk-epub-shelves-sync-increment2-design.md`

## Global Constraints

- **Zero-knowledge (unchanged):** server stores ciphertext only. EPUB bytes, titles, and shelf names are all encrypted — titles ride in `meta_ciphertext` (in the BODY), never plaintext headers. Only `epub_id`, `client_version` (a timestamp), `byte_size`, tombstone are plaintext metadata. LMK never leaves the device.
- **Reuse, don't re-invent:** envelope `seal`/`open` (`mobile/src/crypto/envelope.ts`), `planReconcile` (`mobile/src/sync/syncEngine.ts`, generic over `{id, updatedAt}[]`), the single `runSyncExclusive` mutex (ALL sync work serializes through it), the 1b auto-sync engine + status store.
- **App-level isolation, NOT RLS** (backend rule #4): every query `WHERE owner_account_id = $account`, account from `Principal.sub`.
- **Conflict handling unchanged:** LWW by the item's timestamp (`compiledAt` for EPUBs, a `shelvesUpdatedAt` for shelves).
- **Caps:** per-EPUB hard cap 50 MB → 413 "epub too large"; per-user total soft cap → 413 "sync storage full" (distinct detail). A 413 during push routes the id to `skipped[]`, not `failed[]`, and never aborts the run.
- **Header-size rule:** `meta_ciphertext` (with `coverSvg`, up to ~600 KB) MUST go in the octet-stream body (framed), never an HTTP header (nginx ~8 KB header buffer).
- Run the FULL `npx jest` before finishing (engine changes touch shared files); backend DB tests run vs a real Postgres (skip if no DATABASE_URL).

## File Structure

- **Backend create/modify:** `backend/alembic/versions/0025_sync_epub_and_shelves.py`; `backend/src/sync/{repo.py,router.py,schemas.py}` (add epub + shelves); `backend/tests/test_sync_epub.py`, `test_sync_shelves.py`.
- **Client create:** `mobile/src/sync/epubFraming.ts` (+ test), `mobile/src/sync/epubSync.ts`/`shelvesSync.ts` (or add to syncEngine), tests.
- **Client modify:** `mobile/src/sync/syncClient.ts` (binary + shelves methods), `mobile/src/sync/syncEngine.ts` (syncEpubs/syncShelves + fold into syncNow + status), `mobile/src/storage/shelfStore.ts` (export/import doc + change-notify), `mobile/src/storage/epubLibrary.ts` (change-notify), `mobile/src/components/LibrarySync.tsx` (badge counts), `mobile/src/help-content/topics.ts`.
- **Infra:** `mambakkam-net` nginx configs (body-limit raise) — separate repo, PR.

---

## Task 1: Backend — migration 0025, epub (octet-stream) + shelves endpoints, caps

**Files:** Create `backend/alembic/versions/0025_sync_epub_and_shelves.py`, `backend/tests/test_sync_epub.py`, `backend/tests/test_sync_shelves.py`. Modify `backend/src/sync/{repo.py,router.py,schemas.py}`.

**Interfaces (produced):** routes `GET /sync/epubs`, `PUT/GET/DELETE /sync/epubs/{id}`, `GET/PUT /sync/shelves`.

- [ ] **Step 1: Migration** `0025_sync_epub_and_shelves.py` (`down_revision="0024"`, mirror `0024`'s alembic shape):
  - `synced_epub(owner_account_id uuid FK account(id) ON DELETE CASCADE, epub_id text, ciphertext bytea, nonce bytea, meta_ciphertext bytea, meta_nonce bytea, wrapped_dk bytea, dk_nonce bytea, client_version text, byte_size bigint NOT NULL DEFAULT 0, deleted bool NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now(), PRIMARY KEY (owner_account_id, epub_id))`.
  - `synced_shelves(owner_account_id uuid PK FK account(id) ON DELETE CASCADE, ciphertext bytea, nonce bytea, wrapped_dk bytea, dk_nonce bytea, client_version text, updated_at timestamptz DEFAULT now())`.

- [ ] **Step 2: repo.py** (asyncpg, all scoped by `owner_account_id`): `list_epubs` (metadata only: epub_id, client_version, deleted, updated_at, byte_size), `get_epub` (full row), `upsert_epub`, `tombstone_epub` (deleted=true, byte_size=0), `user_epub_total_bytes` (SUM byte_size WHERE not deleted), `get_shelves`, `upsert_shelves`.

- [ ] **Step 3: router.py** — constants `_MAX_EPUB_BYTES = 50*1024*1024`, `_SOFT_CAP_BYTES = 500*1024*1024`.
  - `GET /sync/epubs` → `list_epubs` → JSON manifest.
  - `PUT /sync/epubs/{epub_id}` — read the raw body (`await request.body()` — octet-stream). Split the framed body: first 4 bytes = `meta_len` (uint32 big-endian, `int.from_bytes(body[:4],"big")`), `meta_ct = body[4:4+meta_len]`, `epub_ct = body[4+meta_len:]`. Read small params from base64 headers (`X-Nonce`, `X-Meta-Nonce`, `X-Wrapped-Dk`, `X-Dk-Nonce`, `X-Client-Version`). **Caps:** `if len(epub_ct) > _MAX_EPUB_BYTES: 413 "epub too large"`; `total = await user_epub_total_bytes(...); existing = (that row's byte_size or 0); if total - existing + len(epub_ct) > _SOFT_CAP_BYTES: 413 "sync storage full"`. `upsert_epub(...)` with `byte_size=len(epub_ct)`. Return 200.
  - `GET /sync/epubs/{epub_id}` → `get_epub`; 404 if absent; build the framed body `meta_len.to_bytes(4,"big") + meta_ct + epub_ct`; return `Response(content=framed, media_type="application/octet-stream", headers={...base64 params...})`.
  - `DELETE /sync/epubs/{epub_id}` → `tombstone_epub`.
  - `GET /sync/shelves` → `get_shelves` (JSON+base64) or 404; `PUT /sync/shelves` → `upsert_shelves` (JSON+base64 like the keyset).
  - All `Depends(require_active_user)` → `_account`; rate-limited; never log the body bytes or key material (log `epub_id`, `byte_size`, `client_version` only). `require_active_user` already imported. FastAPI reads the raw body via `request: Request` — add it to the epub PUT signature. Ensure no app-level body-size limit rejects 40 MB (uvicorn default is unlimited; the cap is enforced in-handler + at nginx).

- [ ] **Step 4: Tests** (mirror `test_sync_router.py`'s TestClient + `require_active_user` override + `_account` DSN-skip pattern):
  - epub PUT (framed body + headers) → GET returns the framed body **byte-for-byte** (meta_ct + epub_ct preserved); `GET /sync/epubs` lists metadata only (no ciphertext); DELETE → deleted + byte_size 0.
  - per-file cap: a >50 MB epub_ct → 413 "epub too large".
  - total soft cap: push epubs until the sum would exceed a (test-lowered) SOFT_CAP → 413 "sync storage full" with the distinct detail.
  - **isolation:** account B can't GET/list A's synced_epub or synced_shelves.
  - shelves PUT/GET round-trip; isolation.
  - no ciphertext/key material in logs.
  Run `cd backend && python3 -m pytest tests/test_sync_epub.py tests/test_sync_shelves.py -q` (DB tests skip without DATABASE_URL — spin up a local Postgres + `alembic upgrade head` to actually run; note skips otherwise). `ruff check`. Commit: `feat(sync): backend synced_epub (octet-stream) + synced_shelves (migration 0025, caps)`

---

## Task 2: Infra — raise the nginx request-body limit (mambakkam-net PR)

**Files:** In the `mambakkam-net` repo (clone fresh, `wegofwd2020-hub/mambakkam-net`): the Mentible backend `location` blocks.

- [ ] Raise `client_max_body_size` from `25m` to `60m` on the Mentible backend proxy locations: the mentible.app host vhost `location /api/` (`infra/nginx/mentible.app.conf`) AND the mambakkam.net `location /mentible-api/` (in `nginx/nginx.conf` or the host mambakkam vhost). Open a PR on mambakkam-net; do NOT apply on the VPS yourself — the reload is a root action the user runs (note it in the PR + the SDD ledger for the rollout step). This task's deliverable is the committed PR + the apply instruction; it has no mobile test.

---

## Task 3: Client — EPUB body framing + large-buffer crypto

**Files:** Create `mobile/src/sync/epubFraming.ts`, `mobile/__tests__/sync/epubFraming.test.ts`.

**Interfaces (produced):**
```ts
export function packEpubBody(metaCt: Uint8Array, epubCt: Uint8Array): Uint8Array; // [u32 BE meta_len][meta][epub]
export function unpackEpubBody(body: Uint8Array): { metaCt: Uint8Array; epubCt: Uint8Array };
```

- [ ] **Step 1: Failing tests:** round-trip `unpack(pack(m,e)) === {m,e}` for small + a LARGE epub (e.g. 5 MB Uint8Array) + empty meta; the uint32 length is big-endian; unpack rejects a truncated body (throws).
- [ ] **Step 2: Implement** — `packEpubBody`: allocate `4 + meta.length + epub.length`, write `meta.length` as uint32 BE into the first 4 bytes (`new DataView(buf).setUint32(0, meta.length, false)`), copy meta then epub. `unpackEpubBody`: read the uint32, slice. Guard `body.length >= 4 + metaLen`.
- [ ] **Step 3:** `npx jest epubFraming && npx tsc --noEmit`. Commit: `feat(sync): EPUB octet-stream body framing (pack/unpack)`

*(EPUB/meta encryption reuses `seal`/`open` from `@/crypto/envelope` directly — they already take `Uint8Array`; no new crypto module. `getEpubBytes` returns `ArrayBuffer` → `new Uint8Array(buf)` before `seal`.)*

---

## Task 4: Client — syncClient binary EPUB + shelves methods

**Files:** Modify `mobile/src/sync/syncClient.ts`. Create `mobile/__tests__/sync/syncClient.epub.test.ts`.

**Interfaces (produced):** `listEpubs(token)`, `putEpub(token, id, body: Uint8Array, headers)`, `getEpub(token, id) → { body: Uint8Array, headers }`, `deleteEpub(token, id)`, `getShelves(token)`, `putShelves(token, blob)`.

- [ ] **Step 1: Failing tests** (mock `@/api/client` `authedFetch` to return a fake Response with `.arrayBuffer()`/`.json()`/`.headers.get`):
  - `putEpub` sends `method:"PUT"`, `Content-Type: application/octet-stream`, the Uint8Array body, and the base64 crypto headers (`X-Nonce`/`X-Meta-Nonce`/`X-Wrapped-Dk`/`X-Dk-Nonce`/`X-Client-Version`).
  - `getEpub` reads `res.arrayBuffer()` → Uint8Array + reads the response headers back.
  - `listEpubs` returns the manifest; `deleteEpub` DELETEs; shelves get/put base64 round-trip.
- [ ] **Step 2: Implement** using the existing `authedFetch(path, token, options)` (returns the raw `Response`). For binary: `authedFetch(\`/sync/epubs/${encodeURIComponent(id)}\`, token, { method:"PUT", headers:{ "Content-Type":"application/octet-stream", "X-Nonce": b64(nonce), ... }, body })` — pass the Uint8Array as `body` (RN fetch accepts it). For GET: `await res.arrayBuffer()`. base64 the small header fields with the existing b64 helper (`@/sync/syncClient`'s or `@/crypto/b64`).
- [ ] **Step 3:** `npx jest syncClient && npx tsc --noEmit`. Commit: `feat(sync): syncClient EPUB (octet-stream) + shelves methods`

---

## Task 5: Client — syncEpubs + syncShelves; fold into syncNow; status; change-notify

**Files:** Modify `mobile/src/sync/syncEngine.ts`, `mobile/src/storage/shelfStore.ts`, `mobile/src/storage/epubLibrary.ts`. Create `mobile/__tests__/sync/syncEpubs.test.ts`, `syncShelves.test.ts`.

- [ ] **Step 1: shelfStore doc + change-notify** — add `export async function exportShelvesDoc(): Promise<{shelves, assignments, updatedAt}>` (reads `sbq_shelves`+`sbq_shelf_assignments` + a persisted `sbq_shelves_updated_at`), `importShelvesDoc(doc)` (writes all three), and bump `sbq_shelves_updated_at` + emit a change event on every mutating shelfStore fn (createShelf/renameShelf/deleteShelf/assign…). Add `subscribeShelfStore(listener)` like `subscribeBookStore`. Similarly add `subscribeEpubLibrary` + emit on `saveEpub`/`deleteEpub` in `epubLibrary.ts`.
- [ ] **Step 2: `syncEpubs(token, lmk)`** — reconcile via `planReconcile(localEpubs.map(m=>({id:m.id,updatedAt:m.compiledAt})), manifest, epubShadow)` (new shadow key `sbq_sync_epub_shadow`):
  - push: `bytes = new Uint8Array(await getEpubBytes(id))`; `dk=generateKey()`; `epubCt=seal(dk,bytes)`; `metaJson=JSON.stringify({title,compiledAt,coverSvg})`; `metaCt=seal(dk, enc(metaJson))`; `wdk=seal(lmk,dk)`; `putEpub(token, id, packEpubBody(metaCt.ct, epubCt.ct), { nonce:epubCt.nonce, metaNonce:metaCt.nonce, wrappedDk:wdk.ct, dkNonce:wdk.nonce, clientVersion:compiledAt })`. On a 413 → id → `skipped[]` (not failed), continue.
  - pull: `getEpub` → `unpackEpubBody` → `dk=open(lmk,dkNonce,wrappedDk)` → `bytes=open(dk,nonce,epubCt)` + `meta=JSON.parse(dec(open(dk,metaNonce,metaCt)))` → `saveEpub({bookId:id, title:meta.title, bytes:bytes.buffer, coverSvg:meta.coverSvg})`.
  - delete: tombstone / local delete, same shadow logic as books. Return `{pushed, pulled, deleted, failed, skipped}`.
- [ ] **Step 3: `syncShelves(token, lmk)`** — single-doc LWW: `local = exportShelvesDoc()`; `server = getShelves(token)` (or null). Compare `local.updatedAt` vs `server.clientVersion` (isoCompare): local newer/only → encrypt the doc (`seal(dk, docJson)` + wrap dk) → `putShelves`; server newer → decrypt → `importShelvesDoc`. equal → skip.
- [ ] **Step 4: fold into `syncNow`** — after the existing book reconcile, run `syncEpubs` then `syncShelves` (still inside `runSyncExclusive`); aggregate counts into the returned `SyncResult` (+ a `skipped` field). Extend `syncStatus` to include epub + shelves pending in its counts (reuse `planReconcile` on the epub manifest; shelves adds 1 if the doc differs), and add a `skipped`/cap surface. Wire the 1b auto-sync edit-trigger to `subscribeEpubLibrary` + `subscribeShelfStore` too (in `autoSync.ts`).
- [ ] **Step 5: Tests** — syncEpubs push/pull/delete via mocked syncClient+envelope+epubLibrary (assert the PUT body is the framed ciphertext, NOT plaintext title/epub bytes — grep the body); a 413 → `skipped`, others continue; syncShelves LWW; `syncNow` runs all three under one mutex; `syncStatus` counts epubs+shelves. `npx jest sync && npx tsc --noEmit`. Commit: `feat(sync): syncEpubs + syncShelves folded into syncNow; epub/shelf change-notify + status`

---

## Task 6: UI badge + Help

**Files:** Modify `mobile/src/components/LibrarySync.tsx`, `mobile/src/help-content/topics.ts`.

- [ ] Badge: `useSyncStatus()` now reflects books+EPUBs+shelves; add a `skipped`/cap line — "N EPUB(s) couldn't sync (too large or storage full)" when the status carries a skipped count. Keep existing states. Test the new copy renders.
- [ ] Help: extend the `library-sync` topic — sync now covers your **reader EPUBs and shelves** too; very large EPUBs (over the size limit) may not sync; conflict note (books LWW) unchanged. `npx jest LibrarySync help && npx tsc --noEmit`, THEN full `npx jest`. Commit: `feat(sync): status badge covers EPUBs+shelves; Help update`

---

## Post-merge (not a code task)

- **★ Device-verify (`mobile:verify`):** encrypt+decrypt a ~30 MB EPUB with `@noble` on Hermes (perf + correctness), then import an EPUB on one emulator instance and confirm it syncs to another. This GATES the single-blob approach — if 30 MB crypto is too slow on Hermes, chunking is a fast-follow. Do it before announcing.
- **Rollout:** backend refresh (migration 0025) + apply the nginx PR as root + web deploy + APK vc47.

## Self-Review

- **Spec coverage:** backend tables/endpoints/caps → T1; nginx → T2; framing → T3; syncClient binary → T4; engine (syncEpubs/syncShelves/fold/status/change-notify) → T5; UI+Help → T6; device-verify → post-merge. All spec sections mapped.
- **Type consistency:** `packEpubBody`/`unpackEpubBody` (T3) consumed by syncClient (T4) + engine (T5); syncClient methods (T4) consumed by engine (T5); `exportShelvesDoc`/`importShelvesDoc`/`subscribeEpubLibrary`/`subscribeShelfStore` (T5) used by autoSync + status. `client_version = compiledAt` throughout.
- **ZK check:** T5's push test asserts the PUT body is ciphertext (no plaintext title/epub); titles in `meta_ciphertext` (body), never headers (T1/T3). Header-size rule honored (meta in body).
- **Placeholder scan:** 50 MB / 500 MB caps, `sbq_sync_epub_shadow`, `sbq_shelves_updated_at` are concrete. No TBD.
- **Risk:** the 30 MB Hermes crypto perf is unproven → the post-merge device-verify gates it (called out, not silently assumed).
