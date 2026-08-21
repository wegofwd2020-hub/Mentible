# Native AES-GCM for EPUB Sync — Increment 2.1 — Design Spec

**Status:** Proposed · **Date:** 2026-08-21 · **Area:** `mobile/src/crypto/*`, `mobile/src/sync/*`, `mobile/src/storage/epubLibrary.ts`, `mobile/src/components/LibrarySync.tsx`, `mobile/app/(tabs)/about.tsx`, `backend/src/sync/*`, `backend/alembic`, `mobile/app.json` (config plugin + build stamp) · **Builds on:** Increment 2 (`2026-08-21-zk-epub-shelves-sync-increment2-design.md`). **Spike:** `reference_native_aes_gcm_spike` (device-verified, GO).

## Why

Increment 2 syncs reader EPUBs zero-knowledge, but the crypto is pure-JS `@noble` AES-GCM. Device-verify (RELEASE Hermes, emulator) measured **~0.9 MB/s** — a 30 MB EPUB blocks the JS thread **~33 s to encrypt and ~34 s to decrypt** (correct, but ANR-risk; sync is opt-in so it ships degraded). The spike proved a native path is **~150× faster and interoperable**:

| Path | 30 MB encrypt | 30 MB decrypt | correct |
|---|---|---|---|
| `@noble` on Hermes (today) | 33.4 s | 33.8 s | ✓ |
| native `encryptFile` (`javax.crypto`) | **0.216 s** | **0.263 s** | ✓ (size + GCM tag) |

Two facts from the spike drive the design: (1) the **in-memory** native path OOMs Hermes's ~200 MB heap at 30 MB (base64 marshaling needs several 30–40 MB copies) — so **file-based is mandatory, not preferred**; (2) native `javax.crypto` GCM **interoperates byte-for-byte** with `@noble` (standard GCM; tag at the 16-byte boundary) — proven both directions, so web can keep `@noble` and Android/native can use the OS cipher, and a book sealed on one opens on the other.

## Decisions (locked)

- **Native uses file-based OS AES-GCM** (`react-native-aes-gcm-crypto`, thin bridge over Android `javax.crypto` / iOS CryptoKit): `encryptFile`/`decryptFile` on the EPUB, which **already lives as a file** (`epubLibrary` native storage = `documentDirectory/epubs/<id>.epub`). No 30 MB ever crosses the JS bridge, on push or pull.
- **Web keeps `@noble` in-memory** (V8 JITs it to ~50–100 MB/s; the web EPUB blob is an IndexedDB `ArrayBuffer`). No native module on web.
- **Wire changes: body = ciphertext only; tag + meta move to headers.** The Increment-2 *framed body* (`[u32 meta_len][metaCt][epubCt]`) is dropped. It existed only so `coverSvg` (up to ~600 KB) could avoid the ~8 KB header limit — but framing makes native streaming impossible (no cheap file prepend). **`coverSvg` is no longer synced** (re-derived on first open, exactly as the raster `coverUri` already is in Inc-2), shrinking `metaCt` to `{title, compiledAt}` — tiny, header-sized.
- **Tag travels as a header** (`X-Tag`, 16 B). Native `encryptFile` returns the tag separately; keeping it separate (vs `@noble`'s appended `ct‖tag`) means **no file append/split** — native uploads the ciphertext file as-is and calls `decryptFile(…, tag)` directly. Web splits/joins the 16 B in memory (trivial on V8; proven in the spike).
- **minSdk 24 → 26** (the module's floor; `javax.crypto` GCM itself works on 24+, the 26 is the library's manifest). Set via an `expo-build-properties` config plugin so prebuild bakes it. Drops Android 7.x (~1–2% of devices) — accepted.
- **Small items unchanged**: keyset, `metaCt`, shelves, and books stay `@noble` everywhere (all small, sub-3 s, no OOM).
- **Conflict handling unchanged** (LWW by `compiledAt`). Caps unchanged (per-file 50 MB / per-user 500 MB, on the body length).

## Crypto seam — `mobile/src/crypto/epubCrypto.ts` (new)

A platform-split module behind one interface. The wire pair is always **(nonce 12 B, tag 16 B, ciphertext)** — identical bytes regardless of producer, so cross-platform interop holds (spike-proven).

```ts
// Result of encrypting an EPUB payload under a per-EPUB data key (DK).
export type SealedEpub = { nonce: Uint8Array; tag: Uint8Array };

// NATIVE (react-native-aes-gcm-crypto):
//   encryptFile(inPath, outPath, base64Key) -> { iv: hex, tag: hex }
//   writes ciphertext-only to outPath. iv=nonce(12B), tag(16B).
export async function sealEpubFileNative(
  dk: Uint8Array, inUri: string, outUri: string): Promise<SealedEpub>;
export async function openEpubFileNative(
  dk: Uint8Array, nonce: Uint8Array, tag: Uint8Array, inUri: string, outUri: string): Promise<void>;

// WEB (@noble): seal gives ct = ciphertext‖tag(16); split the tag out for the wire.
export function sealEpubBytesWeb(
  dk: Uint8Array, bytes: Uint8Array): { nonce: Uint8Array; tag: Uint8Array; ct: Uint8Array };
export function openEpubBytesWeb(
  dk: Uint8Array, nonce: Uint8Array, tag: Uint8Array, ct: Uint8Array): Uint8Array;
```

- `bare(uri)` strips the `file://` scheme (the native module wants a raw filesystem path; expo hands back `file://…`).
- The native key argument is `bytesToBase64(dk)`; `iv`/`tag` are hex (`fromHex`/`toHex` helpers).
- Web `seal` → `{ nonce: s.nonce, tag: s.ct.slice(-16), ct: s.ct.slice(0, -16) }`; web `open` → `open(dk, nonce, concat(ct, tag))`.

## Storage — `epubLibrary.ts` additions (native)

- `getEpubFileUri(id): string` — returns `epubPath(id)` (native) for the crypto to read directly. (Web has no path; the web sync path uses the existing `getEpubBytes`.)
- `saveEpubFileNative({ bookId, title, compiledAt, plaintextUri }): Promise<EpubMeta>` — adopts an already-decrypted plaintext file as `epubs/<id>.epub` (move/rename, no bytes in JS) and updates the AsyncStorage index. This is the pull sink on native. Web pull keeps the existing `saveEpub({ …, bytes })`.

## Client sync — `syncClient.ts` / `syncEngine.ts`

**`syncClient` — two transports, one wire:**
- `putEpubFile(token, epubId, ctFileUri, headers)` (native) — `FileSystem.uploadAsync(url, ctFileUri, { httpMethod: "PUT", uploadType: BINARY_CONTENT, headers })`. Streams the ciphertext file; no JS buffer. `413` → `ApiError` (cap).
- `putEpub(token, epubId, ctBytes, headers)` (web) — existing raw-bytes PUT, body now = ciphertext only (no framing).
- `getEpubToFile(token, epubId, destUri)` (native) — `FileSystem.downloadAsync(url, destUri, { headers })`; returns `{ headers }` (nonce/tag/wrappedDk/dkNonce/meta/metaNonce/clientVersion). Streams to disk.
- `getEpub(token, epubId)` (web) — existing, returns `{ ct: Uint8Array, headers }` (body = ciphertext only now).
- Headers (base64 except `X-Client-Version`): `X-Nonce`, **`X-Tag`** (new), `X-Wrapped-Dk`, `X-Dk-Nonce`, **`X-Meta`** (new — the tiny `metaCt`), `X-Meta-Nonce`, `X-Client-Version` (plaintext `compiledAt`).

**`syncEngine.syncEpubs` — platform branch** (reconcile logic, shadow, LWW, 413→`skipped` all unchanged):
- **Push, native:** `dk = generateKey()`; `sealEpubFileNative(dk, getEpubFileUri(id), tmpCtUri)` → `{nonce, tag}`; `metaCt = seal(dk, {title, compiledAt})`; `wrappedDk = seal(lmk, dk)`; `putEpubFile(id, tmpCtUri, headers)`; delete `tmpCtUri`.
- **Push, web:** `dk = generateKey()`; `sealEpubBytesWeb(dk, getEpubBytes(id))` → `{nonce, tag, ct}`; same meta/wrap; `putEpub(id, ct, headers)`.
- **Pull, native:** `getEpubToFile(id, tmpCtUri)` → headers; `dk = open(lmk, dkNonce, wrappedDk)`; `openEpubFileNative(dk, nonce, tag, tmpCtUri, tmpPlainUri)`; `{title, compiledAt} = decode(open(dk, metaNonce, metaCt))`; `saveEpubFileNative({ bookId:id, title, compiledAt, plaintextUri: tmpPlainUri })`; cleanup.
- **Pull, web:** `getEpub(id)` → `{ct, headers}`; unwrap dk; `openEpubBytesWeb(dk, nonce, tag, ct)` → bytes; decode meta; `saveEpub({ bookId:id, title, compiledAt, bytes })`.
- **413 handling → explicit skip records:** a cap 413 puts `{ id, title, sizeBytes, reason }` (`reason` from the backend's distinct `detail`: `too_large` | `storage_full`) into `skipped[]` — not a bare id — so the UI can name the book + limit (see UI section). Other failures stay in `failed[]`.
- **`compiledAt` still threaded on pull** (the Inc-2 whole-branch fix — `saveEpub*` must not restamp `now()`, or LWW never converges).
- `epubFraming.ts` and its `packEpubBody`/`unpackEpubBody` are **deleted** (no consumer remains).

## Backend — migration `0026`, un-framed body, `tag` column

Isolation stays app-level by `account_id`, ciphertext-only. `backend/src/sync/*`.

**Migration `0026_sync_epub_tag`** (`down_revision = "0025"`):
- Add `synced_epub.tag bytea NOT NULL`.
- **Backfill** existing rows (near-zero in prod — Inc-2 shipped the same day, opt-in). Inc-2 stores `ciphertext = epub_ct` (the `@noble` blob = `actual_ciphertext‖tag(16)`) and `meta_ciphertext` in **separate** columns (verified: router unpacks the framed body on PUT). So the backfill only splits `ciphertext`: `tag = right(ciphertext, 16)`, `ciphertext = left(ciphertext, length(ciphertext) - 16)`, `byte_size = length(ciphertext)`. Tombstones (`byte_size = 0`, `ciphertext = ''`) get `tag = ''`. `meta_ciphertext`/`meta_nonce` columns are **untouched** (retained; Inc-2.1 populates them from the `X-Meta`/`X-Meta-Nonce` headers on new writes). Any Inc-2 EPUB is then readable by the Inc-2.1 client with no re-push.

**Router changes** (`PUT`/`GET /sync/epubs/{epub_id}`):
- `PUT`: body = raw `application/octet-stream` **ciphertext** (no framing). `tag` and `meta_ciphertext` come from `X-Tag` / `X-Meta` headers (base64), `meta_nonce` from `X-Meta-Nonce`. Caps apply to `len(body)`; store `byte_size = len(body)`. Upsert.
- `GET`: body = raw ciphertext; echo `X-Tag`, `X-Meta`, `X-Meta-Nonce`, `X-Nonce`, `X-Wrapped-Dk`, `X-Dk-Nonce`, `X-Client-Version`.
- `GET /sync/epubs` manifest unchanged (`epub_id, client_version, deleted, updated_at, byte_size`).
- `DELETE` tombstone unchanged (also zeroes `tag`).
- Never log ciphertext/tag/keys — log only `epub_id, byte_size, client_version` (as Inc-2).

`SOFT_CAP` / 50 MB per-file constants unchanged. Shelves endpoints unchanged.

## Config / build

- Add deps: `react-native-aes-gcm-crypto`, `expo-build-properties`.
- `app.json` plugins: `["expo-build-properties", { "android": { "minSdkVersion": 26 } }]`. Prebuild bakes minSdk 26 (removes the manual gradle.properties edit the spike used). iOS `deploymentTarget` unaffected (CryptoKit ≥ iOS 13, already met).
- **Build stamp:** the build exports `EXPO_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)` (babel inlines it, like the API base); About reads `expo-constants` `expoConfig.version` + `versionCode` + this SHA (no new dep — `expo-constants` is already present).
- **Infra unchanged from Inc-2's ask:** the raw ciphertext body (~30 MB, no base64 inflation, no framing) still exceeds nginx's 25 MB — the Inc-2 **PR #125 (25→60 MB)** raise still applies and is still required for large EPUBs.

## UI — over-limit is explicit, per-artifact

Inc-2 surfaced a cap hit (413 → `skipped[]`) with **item-neutral** copy ("N EPUBs couldn't sync"). Inc-2.1 makes it **explicit and actionable**, because the client already knows the local title + byte size of every EPUB it skipped:

- The sync-status surface names **each** skipped EPUB by **title**, its **size**, the **reason**, and the **limit** — distinguishing the two cap kinds by the backend's distinct 413 `detail`:
  - too-large (per-file): *"‘<Book Title>’ (34 MB) is over the 50 MB per-book sync limit and wasn't synced."*
  - storage-full (per-user total): *"‘<Book Title>’ wasn't synced — you've used your 500 MB sync storage. Remove synced books to make room."*
- The state persists in the status badge (not just a one-shot alert) so the user can see *which* books aren't syncing after dismissing it — a per-EPUB "not synced (too large)" marker in the Library tab is the durable form (v2.1 shows it in the status panel list; the Library-tab dot remains a later refinement).
- `syncEpubs` therefore returns richer skip records — `{ id, title, sizeBytes, reason: "too_large" | "storage_full" }` — not bare ids, and `syncStatus`/`LibrarySync` render them.

## Build provenance — the device-verify gate must prove build == commit

The Inc-2.1 correctness gate is a device-verify, so it must be **impossible to test a stale build by mistake** (and the current About screen shows a hardcoded `"0.1.0 (MVP)"`, unrelated to the real version — no provenance at all). This increment adds a minimal, always-on build stamp:

- **Bake `EXPO_PUBLIC_GIT_SHA`** (short SHA of the built commit) into the bundle at build time — exported in the build command / CI alongside `EXPO_PUBLIC_API_BASE_URL`, read via `process.env` (inlined by babel like the API base). Absent (dev) → `"dev"`.
- **About screen** shows the real identity: `version` from `expo-constants` (`expoConfig.version` → `0.2.35`) + `versionCode` + the git SHA — replacing the hardcoded `"0.1.0 (MVP)"` string. Also `console.log("[BUILD] sha=… vc=… ver=…")` once at startup so a device-verify can read it from logcat.
- **Device-verify assertion:** the verify step reads the running app's `[BUILD] sha=…` from logcat and asserts it equals the `git rev-parse --short HEAD` the APK was built from **before trusting any on-device result**. A mismatch fails the verify. This closes the "was the emulator even running the code I tested?" gap that this feedback surfaced.

(This is scoped to a build stamp + About fix + a verify assertion — not a full telemetry system. It ships in this increment because Inc-2.1's whole correctness argument rests on a trustworthy device-verify.)

## Security / privacy (invariants preserved)

- Server stores ciphertext + wrapped keys + tag only; `title` stays inside `metaCt` (never a plaintext header). Plaintext metadata is still only `epub_id`, `client_version` (a timestamp), `byte_size`, tombstone.
- LMK never leaves the device; per-EPUB DK wrapped under LMK; recovery-key flow unchanged.
- The native cipher uses the OS keystore-free `javax.crypto`/CryptoKit with a per-EPUB random 12-byte nonce (native `Cipher.getIV()` / expo CSPRNG for web). GCM tag authenticated on every decrypt (`decryptFile` returns false / `@noble` throws on tamper).
- Temp plaintext/ciphertext files live in `cacheDirectory`, deleted immediately after each transfer (best-effort in `finally`).

## Non-goals (Increment 2.1)

- No chunked/resumable upload (single file, whole-file retry on failure).
- No `coverSvg` sync (re-derived on open); no raster-cover sync.
- No key sync (Inc 3); no recovery/re-key (Inc 4); LWW conflict handling unchanged.
- No change to books/shelves/keyset crypto (stay `@noble`).

## Testing

- **Crypto seam (`epubCrypto`):** web `sealEpubBytesWeb`/`openEpubBytesWeb` round-trip (large `Uint8Array`) + tamper→throw; **interop** — a `@noble`-sealed `(nonce,tag,ct)` decrypts via the same split/join a native peer would use, and the wire pair a native peer produces (mocked hex iv/tag + ciphertext) opens under `@noble` (the spike proved the real native side; unit covers the glue). Native module is **mocked in jest** (no native in CI).
- **Backend (`sync/` epub):** migration `0026` up + backfill (a seeded `@noble`-style row splits to `(ciphertext, tag)` with correct `byte_size`; a tombstone gets empty tag); `PUT` stores raw body + `tag`/`meta` headers byte-for-byte; `GET` echoes them; per-file 413; per-user soft-cap 413; **isolation** (account B can't read A's `synced_epub`); no ciphertext/tag/keys in logs.
- **Client engine:** `syncEpubs` push/pull/delete via `planReconcile` on both platform branches (web branch fully testable in jest; native branch's file calls mocked); `compiledAt` convergence test retained (pulled EPUB's saved `compiledAt` == server `client_version` → next reconcile finds no push); a cap 413 → a `skipped` record carrying `{ id, title, sizeBytes, reason }` (both `too_large` and `storage_full` cases), and `syncStatus`/`LibrarySync` render explicit per-title copy.
- **Build provenance:** About renders the real `version`/`versionCode`/SHA (not the hardcoded string); `EXPO_PUBLIC_GIT_SHA` inlines (present → value, absent → `"dev"`); the `[BUILD]` startup log carries them.
- **★ Device-verify (the gate):** **first assert build provenance** — the running app's `[BUILD] sha=…` (logcat) equals the built commit's `git rev-parse --short HEAD`; abort if mismatch. Then the **integrated** native path end-to-end on a real build — import a 30 MB EPUB, `sealEpubFileNative` → `putEpubFile` (streamed) → `getEpubToFile` → `openEpubFileNative` → `saveEpubFileNative`, then **open the pulled book** — and a **cross-device** push→pull between two signed-in devices/accounts. Also verify a >50 MB EPUB surfaces the explicit "over the 50 MB per-book limit" message (not a silent skip). The spike proved the cipher in isolation (216/263 ms, interop OK); this proves the wiring + streaming transfer + real backend + the trustworthy-build guarantee.
- Full `npx jest` green (touches shared sync files).

## Rollout

Order (each gate before the next): dep add + `expo-build-properties` prebuild → backend refresh (**migration 0026**, ROOT runbook) → nginx PR #125 (25→60 MB, ROOT) → web deploy both surfaces → **APK vc48** (built with `EXPO_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)` alongside the prod API base). Backend must lead the client (as in Inc-2) so the new headers/body shape are served before the new client sends them. First real use: a 30 MB EPUB imported on one device appears on another after auto-sync in well under a second of crypto, no jank — and a device-verify that first proves the running build's SHA matches the commit.
