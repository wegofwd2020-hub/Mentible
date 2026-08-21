# Zero-Knowledge Sync — Increment 2 (Reader EPUBs + Shelves) — Design Spec

**Status:** Proposed · **Date:** 2026-08-21 · **Area:** `mobile/src/sync/*`, `mobile/src/storage/{epubLibrary,shelfStore}.ts`, `mobile/src/crypto/*`, `backend/src/sync/*`, `backend/alembic`, mambakkam-net nginx vhosts · **Builds on:** Increment 1 (`2026-08-20-zk-library-sync-increment1-design.md`) + 1b (`2026-08-21-sync-status-autosync-increment1b-design.md`).

## Why

Increment 1/1b sync **authored books** (bookStore JSON) zero-knowledge, with a status badge + auto-sync. Two device-local stores still don't follow the user: the **reader EPUB library** (`epubLibrary` — the "Library" tab's imported/compiled `.epub` blobs) and **shelves** (how those books are organized). Increment 2 syncs both on the existing rails. The hard part is that EPUBs are **large binary blobs** (10–30+ MB) — the sync API today is JSON+base64 with a 20 MB cap and a 25 MB request-body limit, both of which large EPUBs exceed.

## Decisions (locked with the user)

- **Large EPUBs: single blob, binary transfer.** Send EPUB ciphertext as raw `application/octet-stream` (no +33% base64 inflation); one PUT per EPUB; raise the nginx body limit + backend cap. No chunked/resumable upload in v2 (a dropped upload is retried whole).
- **Cost: per-file hard cap + per-user total soft cap.** Per-EPUB 50 MB hard cap → 413. Total-per-user soft cap (~500 MB) → refuse *new* EPUBs past it with a distinct code the client surfaces as "sync storage full."
- **Scope: EPUBs + shelves both.**
- **Conflict handling unchanged** (LWW). No key sync (Inc 3), no re-key/recovery (Inc 4).

## Crypto (reuses the Increment-1 envelope)

Same LMK → per-item DK → AES-256-GCM. New helpers work on bytes (reuse `seal`/`open` from `mobile/src/crypto/envelope.ts`, which already take `Uint8Array`):
- **EPUB payload:** `seal(dk, epubBytes)` → the big ciphertext (octet-stream body). A second `seal(dk, metaJsonBytes)` → a small **meta ciphertext** carrying the EpubMeta-lite `{ title, compiledAt, coverSvg? }` (title is user content → must be ciphertext, not a plaintext header). Both under the SAME per-EPUB DK, each with its own nonce. `wrapped_dk = seal(lmk, dk)`.
- **`client_version` = `compiledAt`** (an ISO timestamp — not sensitive, travels plaintext, exactly like books' `updatedAt`). An EPUB is immutable once compiled; re-saving replaces it with a new `compiledAt`, so LWW by `compiledAt` is correct.
- **Shelves:** the shelves doc `{ shelves: Shelf[], assignments }` (from `sbq_shelves` + `sbq_shelf_assignments`) is small → `seal(dk, docJsonBytes)`, DK wrapped under LMK — same JSON+base64 shape as the keyset.

**Cover simplification (v2):** the inline vector `coverSvg` (small) syncs inside the meta; the raster cover thumbnail (`coverUri`) is NOT synced — a pulled EPUB shows its `coverSvg` or a default cover until re-opened. Raster-cover sync is a later refinement.

## Backend — migration `0025`, binary endpoints, caps

Isolation is app-level by `account_id` (from `Principal.sub`), never RLS — same as Increment 1. Server stores **ciphertext only**.

**Migration `0025_sync_epub_and_shelves`** (`down_revision = "0024"`):
- `synced_epub`: `owner_account_id uuid FK account(id) ON DELETE CASCADE`, `epub_id text`, `ciphertext bytea` (the EPUB payload), `nonce bytea`, `meta_ciphertext bytea`, `meta_nonce bytea`, `wrapped_dk bytea`, `dk_nonce bytea`, `client_version text` (=compiledAt), `byte_size bigint` (ciphertext length — for the total cap), `deleted bool default false`, `updated_at timestamptz default now()`. PK `(owner_account_id, epub_id)`.
- `synced_shelves`: `owner_account_id uuid PK FK account(id) ON DELETE CASCADE`, `ciphertext bytea`, `nonce bytea`, `wrapped_dk bytea`, `dk_nonce bytea`, `client_version text`, `updated_at`. One row/user.

**Router (`/api/v1/sync/*`, `Depends(require_active_user)` → account):**
- `GET /sync/epubs` → `[{ epub_id, client_version, deleted, updated_at, byte_size }]` — **manifest only, no ciphertext**.
- `PUT /sync/epubs/{epub_id}` — `Content-Type: application/octet-stream`; **body is a length-framed pair**: `[uint32 BE meta_len][meta_ciphertext][epub_ciphertext]` (meta first so the server/client can split without buffering the whole EPUB to find it). The `meta_ciphertext` rides in the BODY, not a header, because `coverSvg` can be up to ~600 KB — far past nginx's ~8 KB header buffer. Only the **fixed-small** crypto params go as base64 request headers: `X-Nonce` (epub payload nonce), `X-Meta-Nonce`, `X-Wrapped-Dk`, `X-Dk-Nonce`, `X-Client-Version` (plaintext timestamp). Upsert. **Caps** apply to the epub ciphertext length: if `len(epub_ciphertext) > 50 MB` → `413 "epub too large"`; if `(user_total_bytes − existing_row_bytes + len(epub_ciphertext)) > SOFT_CAP` → `413 "sync storage full"` (distinct `detail`). Store `byte_size = len(epub_ciphertext)`, and persist `meta_ciphertext`/`meta_nonce` in their columns.
- `GET /sync/epubs/{epub_id}` → `application/octet-stream` body = the same `[uint32 meta_len][meta_ciphertext][epub_ciphertext]` framing + the fixed-small params echoed as base64 response headers.
- `DELETE /sync/epubs/{epub_id}` → tombstone (`deleted=true`, `byte_size=0` so it stops counting toward the cap; keep the row for LWW).
- `GET /sync/shelves` → `{ ciphertext, nonce, wrapped_dk, dk_nonce, client_version }` (JSON+base64, or 404/null); `PUT /sync/shelves` → upsert. Small — no octet-stream needed.
- All rate-limited; ciphertext/keys never logged (the byte body and header key-material are excluded from log fields — log only `epub_id`, `byte_size`, `client_version`).
- `SOFT_CAP` and the 50 MB per-file cap are module constants.

**Infra — raise the request-body limit** (large EPUBs, ~40 MB ciphertext observed): bump `client_max_body_size` on the Mentible backend location from **25 MB → 60 MB** on BOTH serving paths — the mentible.app host vhost `location /api/` and the mambakkam.net `location /mentible-api/` (in the `mambakkam-net` repo's nginx configs). Delivered as a mambakkam-net PR; applied on the VPS as root (nginx reload). The GET/PUT epub routes must also allow the larger body in FastAPI/uvicorn if a limit is set there.

## Client — generalize the Increment-1/1b engine

`planReconcile` is already generic over `{ id, updatedAt }[]` → **reuse it for EPUBs** (`epubLibrary.listEpubs()` → `{ id, updatedAt: compiledAt }`; server manifest → `{ bookId: epub_id, clientVersion, deleted, updatedAt }`). A **second sync-shadow** (`sbq_sync_epub_shadow`) tracks synced EPUB ids (books' shadow is unchanged).

- **`syncEpubs(token)`** — reconcile local EPUB metas vs the server manifest (LWW by `compiledAt`), reusing `planReconcile`:
  - push: `getEpubBytes(id)` → `dk = generateKey()` → `seal(dk, bytes)` + `seal(dk, metaJson)` → `wrap dk` → `PUT /sync/epubs/{id}` (octet-stream body + base64 headers). A `413` (too-large / storage-full) is caught → the id goes to a `skipped[]` list (distinct from `failed[]`), surfaced in status.
  - pull: `GET /sync/epubs/{id}` → unwrap dk → decrypt bytes + meta → `saveEpub({ bookId: id, title, bytes, coverSvg })`.
  - delete: tombstone / local delete, same shadow logic as books.
- **`syncShelves(token)`** — single-doc LWW: read the local shelves doc + a locally-persisted `shelvesUpdatedAt` (bump it on any shelf mutation via a small `shelfStore` change hook), compare vs server `client_version`; push (encrypt the doc) or pull (decrypt → write `sbq_shelves` + `sbq_shelf_assignments`).
- **Fold into `syncNow`:** it now runs books → EPUBs → shelves, all inside the single `runSyncExclusive` mutex (no new concurrency surface). Auto-sync triggers (1b) already fire `syncNow`, so EPUBs+shelves auto-sync for free. Big-blob crypto happens per-EPUB inside the serialized run.
- **`syncStatus`** counts EPUBs + shelves too (extend the `planReconcile`-based counts across all three stores); a `skipped` (cap) state surfaces as "N EPUBs too large / storage full."
- **Change notifications:** `epubLibrary.saveEpub/deleteEpub` and `shelfStore` mutations emit change events (like `subscribeBookStore`) so the 1b debounced-edit auto-sync trigger covers EPUB/shelf changes.

**★ Big-blob crypto is the one unproven path** (the spike only covered ~1 MB): a **device-verify** must encrypt+decrypt a ~30 MB EPUB with `@noble` AES-GCM on Hermes (perf + correctness), then push from one device and pull on another end-to-end. If Hermes perf is unacceptable at 30 MB, chunked crypto/transfer becomes a fast-follow (out of scope here, but the finding gates the approach).

## UI

- The Settings sync-status badge (1b) now reflects books + EPUBs + shelves in its counts. A `skipped`/cap state → "N EPUBs couldn't sync (too large or storage full)".
- No per-EPUB "synced" dot in the Library tab in v2 (later). Auto-sync + the panel badge are the surface.
- Help: extend the `library-sync` topic — sync now covers your **reader EPUBs and shelves** too; very large EPUBs may not sync (size limit); books-only conflict note unchanged.

## Security / privacy (unchanged invariants)

- Server stores ciphertext only; EPUB bytes, titles, shelves are all encrypted (title/shelf names are user content → in `meta_ciphertext` / the shelves ciphertext, never plaintext headers). Only `epub_id`, `client_version` (a timestamp), `byte_size`, and tombstone are plaintext metadata.
- LMK never leaves the device; same recovery-key flow. App-level isolation by `account_id`, not RLS.

## Non-goals (Increment 2)

- No chunked/resumable upload (single-blob per EPUB).
- No raster-cover sync (coverSvg only).
- No key sync (Inc 3), no re-key / lost-recovery (Inc 4); conflict handling stays LWW.
- No Library-tab per-item sync indicator; no billing (the total cap is a soft fair-use guard, not metered billing).

## Testing

- **Crypto:** `seal`/`open` round-trip on a large (multi-MB) `Uint8Array`; meta-blob round-trip; tamper→throw. (`envelope` tests already cover small; add a large-buffer case.)
- **Backend (`sync/` epub + shelves):** octet-stream PUT/GET round-trips the ciphertext **byte-for-byte**; manifest lists metadata only; per-file 413; total-soft-cap 413 with the distinct detail; tombstone zeroes `byte_size`; **isolation** — account B can't read A's synced_epub/shelves; shelves upsert/get; no ciphertext/keys in logs.
- **Client engine:** `syncEpubs` push/pull/delete via `planReconcile` (reuse the book reconcile tests' shape); a 413 → id in `skipped`, others continue; `syncShelves` single-doc LWW push/pull; `syncNow` runs all three under the one mutex; `syncStatus` counts all three + the skipped/cap state.
- **★ Device-verify:** 30 MB EPUB encrypt/decrypt on Hermes + cross-device EPUB sync (the gating perf check).
- Full `npx jest` green (engine changes touch shared files).

## Rollout

Backend (`sync/` + migration `0025`) needs a **backend refresh** (ROOT runbook) + the **nginx body-limit raise** (mambakkam-net vhost PR, applied as root) + web deploy + APK (vc47). Additive tables; opt-in (only users who enabled sync + have EPUBs/shelves are affected). First real use: an EPUB imported on one device appears on another after auto-sync; the badge reflects EPUB/shelf state.
