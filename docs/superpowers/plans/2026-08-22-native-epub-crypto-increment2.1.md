# Native AES-GCM for EPUB Sync — Increment 2.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pure-JS `@noble` EPUB sync crypto with OS-native file-based AES-GCM on Android (≈150× faster, no ANR), keeping web on `@noble` and both byte-for-byte interoperable; un-frame the wire (ciphertext-only body, tag+meta in headers); make over-limit sync explicit per-book; and add a build-provenance stamp so the correctness device-verify can prove build == commit.

**Architecture:** A platform-split crypto seam (`epubCrypto.ts` = web `@noble` bytes + shared types/helpers; `epubFileCrypto.ts` (native) / `epubFileCrypto.web.ts` (stub) = native file cipher + a never-called web stub, so the native module never enters the web bundle). `syncClient` gains streamed file transports (native) alongside the existing byte transports (web). `syncEngine.syncEpubs` branches by platform. Backend migration `0026` adds a `tag` column and un-frames the body; the router moves `tag`+`meta` to headers. About gains a real version/SHA stamp.

**Tech Stack:** React Native + Expo (SDK 53, Hermes) · `react-native-aes-gcm-crypto` (Android `javax.crypto` / iOS CryptoKit) · `@noble/ciphers` (web) · `expo-file-system` (streamed upload/download) · `expo-build-properties` (minSdk) · FastAPI + asyncpg + Alembic (backend) · Jest + pytest.

**Spec:** `docs/superpowers/specs/2026-08-21-native-epub-crypto-increment2.1-design.md` (Proposed). Companion: Increment 2 spec `docs/superpowers/specs/2026-08-21-zk-epub-shelves-sync-increment2-design.md` (built — migration `0025` is HEAD, `epubFraming.ts` exists). Spike: `reference_native_aes_gcm_spike` (device-verified GO).

## Global Constraints

- **minSdk 24 → 26** — via an `expo-build-properties` config plugin; prebuild bakes it. Drops Android 7.x (~1–2%), accepted. iOS unaffected.
- **The native module MUST NOT enter the web bundle.** `react-native-aes-gcm-crypto` is Android/iOS-only; importing it on web breaks the web app (see `reference_expo_filesystem_not_on_web`). Isolate every native-module import behind a Metro platform-split file (`*.native.ts` with a `*.web.ts` stub). Web code paths import only `@noble`.
- **Cross-platform wire is identical bytes: `(nonce 12 B, tag 16 B, ciphertext)`.** A native-sealed EPUB opens under `@noble` and vice-versa (spike-proven). Native `javax.crypto` returns `tag` separately; `@noble` appends it (`ct = ciphertext‖tag16`) — the seam normalizes both to the same wire triple.
- **Never log key material, ciphertext, tag, nonce, or plaintext** — client or server. Backend logs only `epub_id, byte_size, client_version` (unchanged from Inc-2). Client never `console.log`s crypto bytes; the one new log (`[BUILD] …`) carries only version/vc/SHA.
- **Caps unchanged:** per-file 50 MB (`_MAX_EPUB_BYTES`), per-user soft cap 500 MB (`_SOFT_CAP_BYTES`), both on the **ciphertext body length**. Distinct 413 details: `"epub too large"` (per-file) / `"sync storage full"` (per-user).
- **LWW by `compiledAt` — the pull path MUST thread `compiledAt`** into `saveEpub*` (never restamp `now()`), or sync ping-pongs forever (the Inc-2 whole-branch regression; see `syncEpubs.convergence.test.ts`).
- **No `coverSvg` sync** (re-derived on open) → `metaCt = {title, compiledAt}` only, small enough for a header.
- **Books, shelves, keyset crypto stay `@noble`** everywhere (all small, sub-3 s, no OOM). Only the EPUB payload goes native.
- **Full `npx jest` green** (no-filter) — engine/client changes touch shared sync files. **Definition of Done:** update the `library-sync` Help topic in the same PR (coverage gate).
- **Backend leads the client:** deploy migration `0026` + router + nginx PR #125 (25→60 MB) before shipping the APK, so the new headers/body shape are served before the new client sends them.
- **Version reality (spec drift):** current is `app.json` `version: 0.2.43`, `android.versionCode: 55` (NOT the spec's stale `0.2.35`/`vc48`). Adding a native module + minSdk is a **native change** → the release is a full native rebuild at **vc56 / next patch version**, baked with `EXPO_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)`.

---

## File Structure

- **Create** `mobile/src/crypto/epubCrypto.ts` — shared `SealedEpub` type, web `@noble` byte fns (`sealEpubBytesWeb`/`openEpubBytesWeb`), and hex/`bare()` helpers. Safe on every platform (pure `@noble`).
- **Create** `mobile/src/crypto/epubFileCrypto.ts` — **base file = native** (repo convention: no `.native.ts` files exist; base is the native default). `sealEpubFileNative`/`openEpubFileNative` over `react-native-aes-gcm-crypto`. The ONLY file importing that module; Metro resolves `.web.ts` first on web, so this base file (with the native import) never enters the web bundle.
- **Create** `mobile/src/crypto/epubFileCrypto.web.ts` — same signatures, bodies `throw new Error("epubFileCrypto is native-only")`. Never called on web (satisfies Metro's web resolution without the native dep).
- **Modify** `mobile/src/storage/epubLibrary.ts` — add `getEpubFileUri(id)` + `saveEpubFileNative(...)` (native); export `epubDir`/`epubPath` for the seam.
- **Modify** `mobile/src/sync/syncClient.ts` — add `putEpubFile`/`getEpubToFile` (native, streamed); rewrite `putEpub`/`getEpub` to ciphertext-only body + `X-Tag`/`X-Meta`/`X-Meta-Nonce` headers (web); extend `EpubBlobHeaders`.
- **Modify** `mobile/src/sync/syncEngine.ts` — platform-branch `syncEpubs`; richer `skipped` records `{ id, title, sizeBytes, reason }`; drop the `epubFraming` import.
- **Delete** `mobile/src/sync/epubFraming.ts` (+ any test) — no consumer remains.
- **Modify** `mobile/src/components/LibrarySync.tsx` (+ `syncStatusStore`/status types as needed) — explicit per-title over-limit copy.
- **Modify** `mobile/app/(tabs)/about.tsx` — real `version`/`versionCode`/SHA via `expo-constants` + `EXPO_PUBLIC_GIT_SHA`.
- **Create** `mobile/src/lib/buildInfo.ts` — reads `expo-constants` + `EXPO_PUBLIC_GIT_SHA`; the `[BUILD]` startup log source. (Small, testable in isolation.)
- **Modify** `mobile/app/_layout.tsx` — emit the `[BUILD]` log once at startup.
- **Modify** `mobile/app.json` — add `expo-build-properties` plugin (minSdk 26); bump `version`/`versionCode` at release.
- **Modify** `mobile/package.json` — add `react-native-aes-gcm-crypto`, `expo-build-properties`.
- **Create** `backend/alembic/versions/0026_sync_epub_tag.py` — add `tag` column + backfill.
- **Modify** `backend/src/sync/repo.py` — `EpubRow.tag`, `_EPUB_COLS`, `upsert_epub`, `get_epub`.
- **Modify** `backend/src/sync/router.py` — un-frame `put_epub`/`get_epub`; `X-Tag`/`X-Meta`/`X-Meta-Nonce`.
- **Modify** `mobile/src/help-content/topics.ts` — extend `library-sync` topic (per-book size limit).

---

## Task 1: Backend — migration `0026` (add `tag`, backfill split) + repo columns

**Files:**
- Create: `backend/alembic/versions/0026_sync_epub_tag.py`
- Modify: `backend/src/sync/repo.py` (`SyncedEpub`/`EpubRow` dataclass ~line 243, `_EPUB_COLS` ~268, `upsert_epub` ~324, `get_epub` ~313)
- Test: `backend/tests/test_migration_0026.py` (create — flat `backend/tests/`, `skipif(not DSN)` like `test_sync_epub.py`; locate the existing alembic-run harness with `grep -rl "command.upgrade\|alembic" backend/tests` and mirror it — if none exists, drive `alembic upgrade` via `subprocess`/`command.upgrade(cfg, "0026_sync_epub_tag")` against the test DB)

**Interfaces:**
- Consumes: existing `synced_epub` (migration `0025`) — columns `owner_account_id, epub_id, ciphertext, nonce, meta_ciphertext, meta_nonce, wrapped_dk, dk_nonce, client_version, byte_size, deleted, updated_at`. `0025` is the current HEAD (`down_revision = "0025"`).
- Produces: `synced_epub.tag bytea NOT NULL`; `EpubRow.tag: bytes`; `upsert_epub(..., tag: bytes)`; `get_epub`/`list_epubs` return rows carrying `tag`.

**Migration semantics (from spec §Backend):** Inc-2 stored `ciphertext = epub_ct` where `epub_ct` is `@noble`'s output = `actual_ciphertext‖tag(16)`, with `byte_size = len(epub_ct)`. The backfill splits the trailing 16 bytes into the new `tag` column and shrinks `ciphertext`/`byte_size` accordingly. Tombstones (`byte_size = 0`, `ciphertext = ''`) get `tag = ''`. `meta_ciphertext`/`meta_nonce` are untouched.

- [ ] **Step 1: Write the migration (raw SQL `op.execute`, matching 0025's style)**

```python
"""synced_epub.tag — split the @noble appended GCM tag into its own column
(Increment 2.1: native file cipher returns tag separately; wire body becomes
ciphertext-only). Backfills existing Inc-2 rows, whose `ciphertext` is
`actual_ciphertext‖tag(16)`.

Revision ID: 0026_sync_epub_tag
Revises: 0025_sync_epub_and_shelves
"""
from alembic import op

revision = "0026_sync_epub_tag"
down_revision = "0025_sync_epub_and_shelves"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Add nullable, backfill, then set NOT NULL (can't add NOT NULL to a
    #    populated table without a default).
    op.execute("ALTER TABLE synced_epub ADD COLUMN tag bytea")
    # 2) Live rows: last 16 bytes are the GCM tag; the rest is ciphertext.
    #    byte_size (used for the per-user cap) becomes the ciphertext length.
    op.execute(
        """
        UPDATE synced_epub
           SET tag        = right(ciphertext, 16),
               ciphertext = left(ciphertext, length(ciphertext) - 16),
               byte_size  = length(ciphertext) - 16
         WHERE deleted = false AND length(ciphertext) >= 16
        """
    )
    # 3) Tombstones (and any empty row): empty tag, ciphertext already ''.
    op.execute(
        r"UPDATE synced_epub SET tag = '\x'::bytea WHERE tag IS NULL"
    )
    op.execute("ALTER TABLE synced_epub ALTER COLUMN tag SET NOT NULL")


def downgrade() -> None:
    # Re-append the tag so a rolled-back Inc-2 client still reads @noble's ct‖tag.
    op.execute(
        "UPDATE synced_epub SET ciphertext = ciphertext || tag, "
        "byte_size = length(ciphertext || tag) WHERE deleted = false"
    )
    op.execute("ALTER TABLE synced_epub DROP COLUMN tag")
```

- [ ] **Step 2: Write the failing migration test**

```python
# backend/tests/sync/test_migration_0026.py
# Seeds an Inc-2-style row (ciphertext = ct‖tag16) + a tombstone on 0025, runs
# 0026, asserts the split. Uses the repo's alembic/db harness — mirror the
# existing migration test in backend/tests/ (find it: grep -rl "command.upgrade" backend/tests).
import pytest

@pytest.mark.asyncio
async def test_0026_splits_tag_and_preserves_meta(migrated_to_0025, run_migration, db):
    # seed: a 40-byte ciphertext (24 ct + 16 tag), byte_size=40, meta untouched
    ct_plus_tag = bytes(range(24)) + bytes([0xAA]) * 16
    await _seed_epub(db, ciphertext=ct_plus_tag, byte_size=40,
                     meta_ciphertext=b"META", meta_nonce=b"N", deleted=False)
    await _seed_epub(db, epub_id="dead", ciphertext=b"", byte_size=0, deleted=True)

    run_migration("0026_sync_epub_tag")

    row = await _fetch_epub(db)
    assert row["tag"] == bytes([0xAA]) * 16
    assert row["ciphertext"] == bytes(range(24))
    assert row["byte_size"] == 24
    assert row["meta_ciphertext"] == b"META"  # untouched
    dead = await _fetch_epub(db, epub_id="dead")
    assert dead["tag"] == b""
```

- [ ] **Step 3: Run it — expect FAIL** (`0026` doesn't exist / `tag` column missing). `cd backend && pytest tests/sync/test_migration_0026.py -v`.

- [ ] **Step 4: Add `tag` to the repo row + queries**

In `backend/src/sync/repo.py`: add `tag: bytes` to the `EpubRow` dataclass (~line 243, after `dk_nonce`); add `tag` to `_EPUB_COLS` (keep ordering — put it right after `dk_nonce`); map `tag=r["tag"]` in the `EpubRow` row-builder (~line 281); add `tag: bytes,` param to `upsert_epub` and thread it through the INSERT column list, the `$N` placeholder, the `ON CONFLICT … tag = EXCLUDED.tag`, and the args tuple.

```python
# EpubRow (add after dk_nonce: bytes)
    tag: bytes
# _EPUB_COLS
_EPUB_COLS = (
    "owner_account_id, epub_id, ciphertext, nonce, meta_ciphertext, meta_nonce, "
    "wrapped_dk, dk_nonce, tag, client_version, byte_size, deleted, updated_at"
)
```

- [ ] **Step 5: Run the migration test — expect PASS.** Then `pytest tests/sync/ -v` to confirm nothing else broke (Task 2 makes the router use `tag`; until then `upsert_epub` callers must pass `tag=` — the router edit is Task 2, so temporarily the existing router won't compile against the new required param: keep `tag` param LAST with no default is fine because Task 1 and Task 2 land as one reviewer gate is NOT assumed — add `tag: bytes = b""` default ONLY if Task 1 is committed separately; otherwise land Steps 4 with Task 2's router in the same commit). **Ruling:** give `upsert_epub`'s `tag` no default (correctness > convenience); commit Task 1 + Task 2 together if the suite must stay green between commits.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/0026_sync_epub_tag.py backend/src/sync/repo.py backend/tests/sync/test_migration_0026.py
git commit -m "feat(sync): migration 0026 — split @noble GCM tag into synced_epub.tag"
```

> **⚠ Spec-gap note (carry to Task 2 + self-review):** a backfilled Inc-2 row's `meta_ciphertext` may contain a `coverSvg` (up to ~600 KB). Inc-2.1's `GET` echoes `meta_ciphertext` as the `X-Meta` **header** (Task 2), which blows the ~8 KB header budget for such rows. Prod has near-zero Inc-2 rows (opt-in, same-day), so the accepted mitigation is: on `GET`, if `len(meta_ciphertext)` exceeds a header-safe bound, return `409`/`410` so the client treats it as "re-push needed" (a fresh Inc-2.1 push writes a tiny meta). Implement the guard in Task 2, Step 4.

---

## Task 2: Backend — un-frame the body, `X-Tag`/`X-Meta`/`X-Meta-Nonce` headers

**Files:**
- Modify: `backend/src/sync/router.py` (`put_epub` ~255, `get_epub` ~312, header helpers `_b64_header`/`_b64e` ~69/83)
- Test: `backend/tests/test_sync_epub.py` (**existing** — rewrite the epub PUT/GET cases + the `_frame`/`_epub_headers`/`_put_epub` helpers)

**Interfaces:**
- Consumes: `repo.upsert_epub(..., tag=…)` and `EpubRow.tag` (Task 1); `_b64_header(request, name)`, `_b64e(bytes)`.
- Produces: `PUT /sync/epubs/{id}` accepts raw ciphertext body + headers `X-Nonce, X-Tag, X-Wrapped-Dk, X-Dk-Nonce, X-Meta, X-Meta-Nonce, X-Client-Version`. `GET` returns raw ciphertext body + echoes those headers. Manifest + `DELETE` unchanged.

**Test harness (existing, in `test_sync_epub.py`):** `fastapi.testclient.TestClient` (NOT httpx AsyncClient); `pytestmark = pytest.mark.skipif(not DSN, ...)` (needs `DATABASE_URL`); auth via `app.dependency_overrides[require_active_user] = lambda: Principal(sub=…, email=…, issuer="test", is_super_admin=False)` (`_as(sub)` helper, autouse `_clear` fixture). The existing helpers `_frame(meta_ct, epub_ct)` / `_epub_headers(...)` / `_put_epub(...)` frame the body + set 5 headers — **rewrite** them: drop `_frame` (body = raw `epub_ct`), add `X-Tag`/`X-Meta` to `_epub_headers`. Update these existing tests: `test_put_then_get_epub_roundtrips_framed_body_byte_for_byte` (→ ciphertext-only, +tag/meta echo), `test_put_epub_malformed_frame_400` (delete — no framing to malform), `test_put_epub_over_per_file_cap_413`, `test_put_epub_over_soft_total_cap_413_with_distinct_detail` (`monkeypatch _SOFT_CAP_BYTES`), `test_put_epub_re_put_excludes_its_own_prior_size_from_the_cap`, `test_epub_isolation_invisible_to_other_account`, `test_no_epub_bytes_or_key_material_in_logs`.

- [ ] **Step 1: Rewrite the epub PUT/GET tests** (TestClient, mirror the existing helpers)

```python
# backend/tests/test_sync_epub.py — new helper shape
def _epub_headers(*, nonce=b"nonce_12____", tag=b"tag_16_bytes____", meta_ct=b"metaCT",
                  meta_nonce=b"metaN", wrapped_dk=b"wdk", dk_nonce=b"dkn", cv="2026-08-22T00:00:00Z"):
    b64 = lambda b: base64.b64encode(b).decode()
    return {"Content-Type": "application/octet-stream",
            "X-Nonce": b64(nonce), "X-Tag": b64(tag), "X-Meta": b64(meta_ct),
            "X-Meta-Nonce": b64(meta_nonce), "X-Wrapped-Dk": b64(wrapped_dk),
            "X-Dk-Nonce": b64(dk_nonce), "X-Client-Version": cv}

def test_put_then_get_epub_ciphertext_only_roundtrips_tag_and_meta(client):
    ct = bytes(range(64))                                   # ciphertext only — no framing, no appended tag
    r = client.put("/api/v1/sync/epubs/e1", content=ct, headers=_epub_headers())
    assert r.status_code == 200
    g = client.get("/api/v1/sync/epubs/e1")
    assert g.content == ct                                  # body is ciphertext-only, byte-for-byte
    assert base64.b64decode(g.headers["X-Tag"]) == b"tag_16_bytes____"
    assert base64.b64decode(g.headers["X-Meta"]) == b"metaCT"
    assert g.headers["X-Client-Version"] == "2026-08-22T00:00:00Z"
# + over_per_file_cap_413 ("epub too large"), over_soft_cap_413 ("sync storage full"),
#   re_put_excludes_own_size, isolation (account B → 404), no_key_material_in_logs — updated for the new wire.
```

- [ ] **Step 2: Run — expect FAIL** (`put_epub` still reads a framed body; `X-Tag`/`X-Meta` unread).

- [ ] **Step 3: Rewrite `put_epub`** — body is raw ciphertext; caps on `len(body)`; tag/meta from headers.

```python
async def put_epub(epub_id, request, principal=..., conn=...):
    account = await _account(conn, principal)
    epub_ct = await request.body()                     # raw ciphertext, NO framing
    nonce      = _b64_header(request, "X-Nonce")
    tag        = _b64_header(request, "X-Tag")         # NEW
    wrapped_dk = _b64_header(request, "X-Wrapped-Dk")
    dk_nonce   = _b64_header(request, "X-Dk-Nonce")
    meta_ct    = _b64_header(request, "X-Meta")        # NEW — tiny {title,compiledAt}
    meta_nonce = _b64_header(request, "X-Meta-Nonce")
    client_version = request.headers.get("X-Client-Version")
    if client_version is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing header X-Client-Version")
    if len(epub_ct) > _MAX_EPUB_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "epub too large")
    existing = await repo.get_epub_byte_size(conn, owner_account_id=account.id, epub_id=epub_id) or 0
    total = await repo.user_epub_total_bytes(conn, owner_account_id=account.id)
    if total - existing + len(epub_ct) > _SOFT_CAP_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "sync storage full")
    e = await repo.upsert_epub(conn, owner_account_id=account.id, epub_id=epub_id,
        ciphertext=epub_ct, nonce=nonce, meta_ciphertext=meta_ct, meta_nonce=meta_nonce,
        wrapped_dk=wrapped_dk, dk_nonce=dk_nonce, tag=tag,
        client_version=client_version, byte_size=len(epub_ct))
    log.info("sync_epub_put", epub_id=epub_id, byte_size=e.byte_size, client_version=client_version)
    return schemas.EpubMetaOut.from_repo(e)
```

Note `_b64_header` (existing) already guards small-field size; `X-Meta`'s tiny `{title,compiledAt}` fits its budget. Since the header guard uses `_MAX_SMALL_FIELD_B64_CHARS` (4 KB), confirm the guard is applied to `X-Meta` too (it is, via `_b64_header`).

- [ ] **Step 4: Rewrite `get_epub`** — body is ciphertext-only; echo the new headers; add the backfill meta-size guard (spec-gap note, Task 1).

```python
async def get_epub(epub_id, principal=..., conn=...) -> Response:
    account = await _account(conn, principal)
    e = await repo.get_epub(conn, owner_account_id=account.id, epub_id=epub_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "epub not found")
    if len(e.meta_ciphertext) > _MAX_SMALL_FIELD_BYTES:
        # A pre-2.1 backfilled row whose meta still carries a coverSvg — too big
        # for the X-Meta header. Signal "re-push under 2.1" rather than fail opaquely.
        raise HTTPException(status.HTTP_409_CONFLICT, "epub meta too large — re-sync required")
    return Response(content=e.ciphertext, media_type="application/octet-stream",
        headers={
            "X-Nonce": _b64e(e.nonce), "X-Tag": _b64e(e.tag),
            "X-Wrapped-Dk": _b64e(e.wrapped_dk), "X-Dk-Nonce": _b64e(e.dk_nonce),
            "X-Meta": _b64e(e.meta_ciphertext), "X-Meta-Nonce": _b64e(e.meta_nonce),
            "X-Client-Version": e.client_version,
        })
```

- [ ] **Step 5: Run tests — expect PASS.** Then `pytest tests/sync/ -v`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/sync/router.py backend/tests/test_sync_epub.py
git commit -m "feat(sync): un-frame epub body; carry tag + meta as headers (Inc 2.1 backend)"
```

---

## Task 3: Crypto seam — `epubCrypto.ts` (web) + `epubFileCrypto.ts` (native base) + `.web.ts` (stub)

**Files:**
- Create: `mobile/src/crypto/epubCrypto.ts`, `mobile/src/crypto/epubFileCrypto.ts` (native base), `mobile/src/crypto/epubFileCrypto.web.ts` (stub)
- Test: `mobile/__tests__/crypto/epubCrypto.test.ts`

**Interfaces:**
- Consumes: `@noble/ciphers/aes` `gcm`; `randomNonce`, `generateKey` from `@/crypto/envelope`; `bytesToBase64` from `@/crypto/b64`; `react-native-aes-gcm-crypto` (native only).
- Produces:
  ```ts
  export type SealedEpub = { nonce: Uint8Array; tag: Uint8Array };
  // web (@noble):
  export function sealEpubBytesWeb(dk, bytes): { nonce; tag; ct };  // ct = ciphertext WITHOUT tag
  export function openEpubBytesWeb(dk, nonce, tag, ct): Uint8Array;
  export function bare(uri: string): string;                        // strip file://
  export const toHex, fromHex;                                      // hex <-> bytes
  // native (epubFileCrypto):
  export function sealEpubFileNative(dk, inUri, outUri): Promise<SealedEpub>;
  export function openEpubFileNative(dk, nonce, tag, inUri, outUri): Promise<void>;
  ```

- [ ] **Step 1: Write the failing web + glue tests**

```ts
// mobile/__tests__/crypto/epubCrypto.test.ts
import { sealEpubBytesWeb, openEpubBytesWeb, toHex, fromHex, bare } from "@/crypto/epubCrypto";
import { generateKey } from "@/crypto/envelope";

it("web seal/open round-trips a large buffer", () => {
  const dk = generateKey();
  const data = new Uint8Array(2_000_000).map((_, i) => i & 0xff);
  const { nonce, tag, ct } = sealEpubBytesWeb(dk, data);
  expect(tag.length).toBe(16);
  expect(openEpubBytesWeb(dk, nonce, tag, ct)).toEqual(data);
});
it("tamper → throw", () => {
  const dk = generateKey();
  const { nonce, tag, ct } = sealEpubBytesWeb(dk, new Uint8Array([1,2,3]));
  ct[0] ^= 0xff;
  expect(() => openEpubBytesWeb(dk, nonce, tag, ct)).toThrow();
});
it("interop glue: a native-shape (nonce,tag,ct) opens under @noble", () => {
  // Prove the split/join is @noble-wire-compatible: seal, split as native would
  // (tag separate), then re-open by concatenating ct‖tag — the shape a native
  // peer produces. (The REAL native cipher is device-verified; this covers glue.)
  const dk = generateKey();
  const { nonce, tag, ct } = sealEpubBytesWeb(dk, new Uint8Array([9,8,7,6,5]));
  expect(openEpubBytesWeb(dk, nonce, tag, ct)).toEqual(new Uint8Array([9,8,7,6,5]));
});
it("bare strips file://", () => { expect(bare("file:///a/b.epub")).toBe("/a/b.epub"); });
it("toHex/fromHex round-trip", () => {
  const b = new Uint8Array([0,255,16,1]); expect(fromHex(toHex(b))).toEqual(b);
});
```

- [ ] **Step 2: Run — expect FAIL** (module absent). `cd mobile && npx jest __tests__/crypto/epubCrypto.test.ts`.

- [ ] **Step 3: Implement `epubCrypto.ts`** (web + shared, pure `@noble`)

```ts
import { gcm } from "@noble/ciphers/aes";
import { randomNonce } from "@/crypto/envelope";

export type SealedEpub = { nonce: Uint8Array; tag: Uint8Array };

// @noble gcm.encrypt → ciphertext‖tag(16). Split the trailing tag so the wire
// is the platform-neutral (nonce, tag, ct-without-tag) triple.
export function sealEpubBytesWeb(dk: Uint8Array, bytes: Uint8Array) {
  const nonce = randomNonce();
  const full = gcm(dk, nonce).encrypt(bytes);
  return { nonce, tag: full.slice(-16), ct: full.slice(0, -16) };
}
export function openEpubBytesWeb(dk: Uint8Array, nonce: Uint8Array, tag: Uint8Array, ct: Uint8Array) {
  const full = new Uint8Array(ct.length + tag.length);
  full.set(ct, 0); full.set(tag, ct.length);
  return gcm(dk, nonce).decrypt(full);          // throws on tamper / wrong key
}
export function bare(uri: string): string { return uri.replace(/^file:\/\//, ""); }
export function toHex(b: Uint8Array): string {
  let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s;
}
export function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i*2, i*2+2), 16);
  return out;
}
```

- [ ] **Step 4: Implement `epubFileCrypto.ts`** (native base — the ONLY native-module importer)

```ts
import AesGcmCrypto from "react-native-aes-gcm-crypto";
import { bytesToBase64 } from "@/crypto/b64";
import { bare, toHex, fromHex, type SealedEpub } from "@/crypto/epubCrypto";

// encryptFile(inPath, outPath, base64Key) -> { iv: hex, tag: hex }; writes
// ciphertext-only to outPath. iv = 12B nonce, tag = 16B. No 30MB across the JS bridge.
export async function sealEpubFileNative(dk: Uint8Array, inUri: string, outUri: string): Promise<SealedEpub> {
  const { iv, tag } = await AesGcmCrypto.encryptFile(bare(inUri), bare(outUri), bytesToBase64(dk));
  return { nonce: fromHex(iv), tag: fromHex(tag) };
}
export async function openEpubFileNative(dk: Uint8Array, nonce: Uint8Array, tag: Uint8Array, inUri: string, outUri: string): Promise<void> {
  await AesGcmCrypto.decryptFile(bare(inUri), bare(outUri), bytesToBase64(dk), toHex(nonce), toHex(tag));
}
```

> Verify the exact `react-native-aes-gcm-crypto` `encryptFile`/`decryptFile` argument order/return against the installed version's types during Task 9 (dep add) — adjust this glue if the API differs. The spike used this module; confirm signatures at install.

- [ ] **Step 5: Implement `epubFileCrypto.web.ts`** (never-called stub — keeps the native module out of the web bundle)

```ts
import type { SealedEpub } from "@/crypto/epubCrypto";
const NATIVE_ONLY = "epubFileCrypto is native-only (web uses sealEpubBytesWeb)";
export async function sealEpubFileNative(): Promise<SealedEpub> { throw new Error(NATIVE_ONLY); }
export async function openEpubFileNative(): Promise<void> { throw new Error(NATIVE_ONLY); }
```

- [ ] **Step 6: Run tests — expect PASS.** (`epubCrypto.test.ts` imports only the web/shared module; native file fns are covered by the engine test's mock in Task 6 + the device-verify.)

- [ ] **Step 7: Commit**

```bash
git add mobile/src/crypto/epubCrypto.ts mobile/src/crypto/epubFileCrypto.ts mobile/src/crypto/epubFileCrypto.web.ts mobile/__tests__/crypto/epubCrypto.test.ts
git commit -m "feat(crypto): epub AES-GCM seam — @noble bytes (web) + native file cipher (platform-split)"
```

---

## Task 4: `epubLibrary` — native file accessors (`getEpubFileUri`, `saveEpubFileNative`)

**Files:**
- Modify: `mobile/src/storage/epubLibrary.ts` (`epubDir`/`epubPath` ~239, native helpers)
- Test: `mobile/__tests__/storage/epubLibrary.fileaccess.test.ts` (create) — reuse the in-memory `expo-file-system` mock shape from `__tests__/sync/syncEpubs.convergence.test.ts` (lines 34+)

**Interfaces:**
- Consumes: `epubPath(id)`, `readIndex`/`writeIndex`, `EpubMeta`, `FileSystem` (`expo-file-system`), `ensureDir`.
- Produces:
  ```ts
  export function getEpubFileUri(id: string): string;   // native: epubPath(id); web: throws (unused)
  export async function saveEpubFileNative(input: {
    bookId: string; title: string; compiledAt: string; plaintextUri: string;
  }): Promise<EpubMeta>;    // moves plaintextUri → epubPath(bookId), updates index, no bytes in JS
  ```

- [ ] **Step 1: Write failing test**

```ts
// asserts saveEpubFileNative moves the temp plaintext file to epubs/<id>.epub,
// writes an index entry with the passed compiledAt (NOT now()), size from getInfoAsync,
// and that getEpubFileUri returns that path. Native path (Platform.OS default "ios").
it("adopts a decrypted plaintext file and indexes it with the given compiledAt", async () => {
  // seed a fake temp file in the fs mock, call saveEpubFileNative, assert move + index
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// native section of epubLibrary.ts
export function getEpubFileUri(id: string): string {
  if (isWeb) throw new Error("getEpubFileUri is native-only");
  return epubPath(id);
}

async function nativeSaveFile({ bookId, title, compiledAt, plaintextUri }:
  { bookId: string; title: string; compiledAt: string; plaintextUri: string }): Promise<EpubMeta> {
  await ensureDir(epubDir());
  const dest = epubPath(bookId);
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.moveAsync({ from: plaintextUri, to: dest });     // no bytes in JS
  const info = await FileSystem.getInfoAsync(dest);
  const meta: EpubMeta = {
    id: bookId, title,
    sizeBytes: info.exists && "size" in info ? (info.size as number) : 0,
    compiledAt,
  };
  const index = (await readIndex()).filter((m) => m.id !== bookId);
  await writeIndex([meta, ...index]);
  return meta;
}
export async function saveEpubFileNative(input: { bookId: string; title: string; compiledAt: string; plaintextUri: string }): Promise<EpubMeta> {
  const meta = await nativeSaveFile(input);
  _emit();
  return meta;
}
```

- [ ] **Step 4: Run — expect PASS.** `npx jest __tests__/storage/epubLibrary`.

- [ ] **Step 5: Commit** `feat(library): native file accessors for streamed epub sync`.

---

## Task 5: `syncClient` — streamed native transports + ciphertext-only web transports

**Files:**
- Modify: `mobile/src/sync/syncClient.ts` (`EpubBlobHeaders` ~line with interface, `epubRequestHeaders`, `putEpub`, `getEpub`)
- Test: `mobile/__tests__/sync/syncClient.epub.test.ts` (**existing** — singular; extend)

**Interfaces:**
- Consumes: `authedFetch`, `ApiError`, **`resolveBaseUrl`** from `@/api/client` (export it if not already — it builds `BASE_URL` with the `EXPO_PUBLIC_API_BASE_URL` + emulator-fallback logic; reuse it verbatim so the streamed transports hit the same host as `authedFetch`); `bytesToBase64`/`base64ToBytes`; `FileSystem` (native transports).
- Produces (extended `EpubBlobHeaders` + four transports):
  ```ts
  export interface EpubBlobHeaders {
    nonce: Uint8Array; tag: Uint8Array;            // + tag (NEW)
    metaCt: Uint8Array; metaNonce: Uint8Array;     // + metaCt (NEW; was framed in body)
    wrappedDk: Uint8Array; dkNonce: Uint8Array; clientVersion: string;
  }
  // web (ciphertext-only body):
  export async function putEpub(token, epubId, ct: Uint8Array, h: EpubBlobHeaders): Promise<void>;
  export async function getEpub(token, epubId): Promise<{ ct: Uint8Array; headers: EpubBlobHeaders }>;
  // native (streamed file, no JS buffer):
  export async function putEpubFile(token, epubId, ctFileUri: string, h: EpubBlobHeaders): Promise<void>;
  export async function getEpubToFile(token, epubId, destUri: string): Promise<{ headers: EpubBlobHeaders }>;
  ```

- [ ] **Step 1: Write failing web transport tests** (mock `authedFetch`; assert headers + ct-only body; 413 → ApiError; native transports covered structurally + in the engine test with `FileSystem` mocked).

```ts
it("putEpub sends ciphertext body + X-Tag/X-Meta headers, no framing", async () => { ... });
it("getEpub returns ct + decoded headers incl tag & metaCt", async () => { ... });
it("putEpub 413 → ApiError(status 413)", async () => { ... });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Extend headers + web transports**

```ts
function epubRequestHeaders(h: EpubBlobHeaders): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "X-Nonce": bytesToBase64(h.nonce),
    "X-Tag": bytesToBase64(h.tag),                 // NEW
    "X-Meta": bytesToBase64(h.metaCt),             // NEW (tiny)
    "X-Meta-Nonce": bytesToBase64(h.metaNonce),
    "X-Wrapped-Dk": bytesToBase64(h.wrappedDk),
    "X-Dk-Nonce": bytesToBase64(h.dkNonce),
    "X-Client-Version": h.clientVersion,           // plaintext (unchanged)
  };
}
export async function putEpub(token, epubId, ct: Uint8Array, h: EpubBlobHeaders): Promise<void> {
  const res = await authedFetch(`/sync/epubs/${encodeURIComponent(epubId)}`, token,
    { method: "PUT", headers: epubRequestHeaders(h), body: ct });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
}
export async function getEpub(token, epubId): Promise<{ ct: Uint8Array; headers: EpubBlobHeaders }> {
  const res = await authedFetch(`/sync/epubs/${encodeURIComponent(epubId)}`, token);
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  const ct = new Uint8Array(await res.arrayBuffer());
  return { ct, headers: decodeEpubHeaders(res.headers) };
}
// decodeEpubHeaders: read X-Nonce/X-Tag/X-Meta/X-Meta-Nonce/X-Wrapped-Dk/X-Dk-Nonce (base64→bytes)
// + X-Client-Version (plaintext); throw ApiError if any required one is missing.
```

- [ ] **Step 4: Add native streamed transports** (isolate `expo-file-system` import; the module already runs on both platforms, but `uploadAsync`/`downloadAsync` are native — the native engine branch is the only caller, so a web bundle never invokes them).

```ts
import * as FileSystem from "expo-file-system";
import { resolveBaseUrl } from "@/api/client";   // reuse the SAME base as authedFetch

function epubUrl(epubId: string): string {
  return `${resolveBaseUrl()}/api/v1/sync/epubs/${encodeURIComponent(epubId)}`;
}
export async function putEpubFile(token, epubId, ctFileUri: string, h: EpubBlobHeaders): Promise<void> {
  const res = await FileSystem.uploadAsync(epubUrl(epubId), ctFileUri, {
    httpMethod: "PUT", uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { Authorization: `Bearer ${token}`, ...epubRequestHeaders(h) },
  });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, res.body ?? "");
}
export async function getEpubToFile(token, epubId, destUri: string): Promise<{ headers: EpubBlobHeaders }> {
  const res = await FileSystem.downloadAsync(epubUrl(epubId), destUri, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, "");
  return { headers: decodeEpubHeaders(new Headers(res.headers as Record<string, string>)) };
}
```

> Confirm `authedFetch`'s base-URL + auth-header construction in `@/api/client` and reuse the exact same base/fallback here (Task 5 review). `uploadAsync` bypasses `authedFetch`, so it must replicate the `Authorization: Bearer` header and base URL identically.

- [ ] **Step 5: Run tests — expect PASS.** `npx jest __tests__/sync/syncClient`.

- [ ] **Step 6: Commit** `feat(sync): streamed native epub transports + ciphertext-only web wire`.

---

## Task 6: `syncEngine.syncEpubs` — platform branch, richer skip records, drop framing

**Files:**
- Modify: `mobile/src/sync/syncEngine.ts` (`EpubSyncResult` ~272, `syncEpubs` ~282; remove `import { packEpubBody, unpackEpubBody }` ~28)
- Delete: `mobile/src/sync/epubFraming.ts` **and** `mobile/__tests__/sync/epubFraming.test.ts`
- Test: rewrite `mobile/__tests__/sync/syncEpubs.test.ts` (it used the real `epubFraming`, now gone) + rework `mobile/__tests__/sync/syncEpubs.convergence.test.ts` for the native file path

**★ Test-platform reality (from the code map):** jest-expo defaults `Platform.OS` to **native** (`"ios"`), so `syncEpubs`'s **native** branch is the DEFAULT jest path — its `epubFileCrypto` (`sealEpubFileNative`/`openEpubFileNative`), `syncClient.putEpubFile`/`getEpubToFile`, and the temp `FileSystem` calls must be mocked, and `saveEpubFileNative` exercised. To test the **web** branch, force `Platform.OS = "web"` (e.g. `jest.mock("react-native/Libraries/Utilities/Platform", …)` or the repo's existing platform-override helper). The `convergence.test.ts` (which asserts `compiledAt` threading) currently runs the native save path with a real `epubLibrary` + in-memory `expo-file-system` mock — rework it so the pull path goes through `getEpubToFile` → `openEpubFileNative` → `saveEpubFileNative` and still asserts the saved `compiledAt` equals the server's, not `now()`.

**★ Preserve the plaintext-on-wire guard:** the existing engine tests mock `@/crypto/envelope` `seal`/`open` with a **non-identity** transform (`xorObfuscate`, XOR 0xff) so a pass-through regression fails "no plaintext on the wire" assertions. Mock `@/crypto/epubCrypto` (`sealEpubBytesWeb`) and `@/crypto/epubFileCrypto` the same way — a non-identity transform — so a bug that uploads plaintext is caught.

**Interfaces:**
- Consumes: `epubCrypto` (`sealEpubBytesWeb`/`openEpubBytesWeb`), `epubFileCrypto` (`sealEpubFileNative`/`openEpubFileNative` — Metro-resolved), `epubLibrary` (`getEpubFileUri`, `getEpubBytes`, `saveEpub`, `saveEpubFileNative`, `listEpubs`, `deleteEpub`), `syncClient` (`putEpub`/`getEpub`/`putEpubFile`/`getEpubToFile`), `seal`/`open`/`generateKey` from `@/crypto/envelope`, `FileSystem` (temp files), `Platform`.
- Produces:
  ```ts
  export type EpubSkip = { id: string; title: string; sizeBytes: number; reason: "too_large" | "storage_full" };
  export interface EpubSyncResult {
    pushedEpubs: number; pulledEpubs: number; deletedEpubs: number;
    failed: string[]; skipped: EpubSkip[];      // was string[]
  }
  ```

- [ ] **Step 1: Write failing tests** — web branch push/pull/delete via `planReconcile` (mock `syncClient`, `epubCrypto` real, `epubLibrary` real web or mocked); a 413 with detail `"epub too large"` → `skipped: [{id,title,sizeBytes,reason:"too_large"}]`, and `"sync storage full"` → `reason:"storage_full"`; the convergence test still passes; native branch with `epubFileCrypto` + `FileSystem` + `syncClient.putEpubFile/getEpubToFile` mocked.

```ts
it("web push: seals ct-only + meta header, PUTs, shadows", async () => { ... });
it("web pull: gets ct+headers, opens, saveEpub with server compiledAt (convergence)", async () => { ... });
it("413 too_large → explicit skip record with title+size+reason", async () => {
  // mock putEpub to throw ApiError(413, "epub too large")
  // expect result.skipped[0] === { id, title, sizeBytes, reason: "too_large" }
});
it("413 storage_full → reason storage_full", async () => { ... });
it("native push: sealEpubFileNative → putEpubFile → temp cleanup", async () => { ... });
```

- [ ] **Step 2: Run — expect FAIL** (framing removed, skip shape changed).

- [ ] **Step 3: Reshape `EpubSyncResult.skipped` + reason parsing**

```ts
// The 413 detail rides in ApiError.body (FastAPI serializes HTTPException as
// {"detail": "..."}), NOT e.message. Match on the two distinct backend strings.
function skipReason(e: ApiError): "too_large" | "storage_full" {
  return /storage/i.test(e.body) ? "storage_full" : "too_large";   // "sync storage full" | "epub too large"
}
```

- [ ] **Step 4: Rewrite `syncEpubs` push loop (platform branch)**

```ts
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { sealEpubBytesWeb, openEpubBytesWeb } from "@/crypto/epubCrypto";
import { sealEpubFileNative, openEpubFileNative } from "@/crypto/epubFileCrypto";

const isWeb = Platform.OS === "web";
const tmp = (id: string, kind: string) => `${FileSystem.cacheDirectory}sync-${kind}-${id}.bin`;
const metaBytes = (m: { title: string; compiledAt: string }) =>
  new TextEncoder().encode(JSON.stringify({ title: m.title, compiledAt: m.compiledAt }));

// ── push one epub ──
for (const id of plan.toPush) {
  const meta = localEpubs.find((m) => m.id === id);
  if (!meta) { failed.push(id); continue; }
  const dk = generateKey();
  const metaCt = seal(dk, metaBytes(meta));
  const wrappedDk = seal(lmk, dk);
  try {
    if (isWeb) {
      const raw = await epubLibrary.getEpubBytes(id);
      if (!raw) throw new Error("bytes vanished");
      const sealed = sealEpubBytesWeb(dk, new Uint8Array(raw));
      await syncClient.putEpub(token, id, sealed.ct, {
        nonce: sealed.nonce, tag: sealed.tag, metaCt: metaCt.ct, metaNonce: metaCt.nonce,
        wrappedDk: wrappedDk.ct, dkNonce: wrappedDk.nonce, clientVersion: meta.compiledAt });
    } else {
      const ctUri = tmp(id, "ct");
      try {
        const sealed = await sealEpubFileNative(dk, epubLibrary.getEpubFileUri(id), ctUri);
        await syncClient.putEpubFile(token, id, ctUri, {
          nonce: sealed.nonce, tag: sealed.tag, metaCt: metaCt.ct, metaNonce: metaCt.nonce,
          wrappedDk: wrappedDk.ct, dkNonce: wrappedDk.nonce, clientVersion: meta.compiledAt });
      } finally { await FileSystem.deleteAsync(ctUri, { idempotent: true }).catch(() => {}); }
    }
    shadow.add(id); pushedEpubs++;
  } catch (e) {
    if (e instanceof ApiError && e.status === 413)
      skipped.push({ id, title: meta.title, sizeBytes: meta.sizeBytes, reason: skipReason(e) });
    else failed.push(id);
  }
}
```

- [ ] **Step 5: Rewrite the pull loop (platform branch)**

```ts
for (const id of plan.toPull) {
  try {
    if (isWeb) {
      const { ct, headers } = await syncClient.getEpub(token, id);
      const dk = open(lmk, headers.dkNonce, headers.wrappedDk);
      const bytes = openEpubBytesWeb(dk, headers.nonce, headers.tag, ct);
      const m = JSON.parse(new TextDecoder().decode(open(dk, headers.metaNonce, headers.metaCt))) as { title: string; compiledAt: string };
      await epubLibrary.saveEpub({ bookId: id, title: m.title, bytes: bytes.slice().buffer as ArrayBuffer, compiledAt: m.compiledAt });
    } else {
      const ctUri = tmp(id, "ct"), plainUri = tmp(id, "plain");
      try {
        const { headers } = await syncClient.getEpubToFile(token, id, ctUri);
        const dk = open(lmk, headers.dkNonce, headers.wrappedDk);
        await openEpubFileNative(dk, headers.nonce, headers.tag, ctUri, plainUri);
        const m = JSON.parse(new TextDecoder().decode(open(dk, headers.metaNonce, headers.metaCt))) as { title: string; compiledAt: string };
        await epubLibrary.saveEpubFileNative({ bookId: id, title: m.title, compiledAt: m.compiledAt, plaintextUri: plainUri });
      } finally {
        await FileSystem.deleteAsync(ctUri, { idempotent: true }).catch(() => {});
        // plainUri is MOVED by saveEpubFileNative on success; delete defensively on failure
        await FileSystem.deleteAsync(plainUri, { idempotent: true }).catch(() => {});
      }
    }
    shadow.add(id); pulledEpubs++;
  } catch { failed.push(id); }
}
```

Delete/tombstone loops unchanged. Remove the `packEpubBody`/`unpackEpubBody` import.

- [ ] **Step 6: Delete `epubFraming.ts`** (+ test): `git rm mobile/src/sync/epubFraming.ts`; `grep -rl epubFraming mobile/` must return nothing after.

- [ ] **Step 7: Run — expect PASS**, incl. `syncEpubs.convergence.test.ts`. Then `npx jest __tests__/sync`.

- [ ] **Step 8: Commit** `feat(sync): native/web branch for syncEpubs; explicit per-book skip records; drop framing`.

---

## Task 7: UI — explicit per-book over-limit messaging

**Files:**
- Modify: `mobile/src/components/LibrarySync.tsx` (~lines 146-147 — the `problems.push(...)` skip copy), `mobile/src/sync/syncStatusStore.ts` / the `SyncStatus` type in `syncEngine.ts` if skip detail must persist in the badge
- Modify: `mobile/src/help-content/topics.ts` (`library-sync` topic — per-book size limit)
- Test: `mobile/__tests__/components/LibrarySync.*` (extend)

**Interfaces:**
- Consumes: `EpubSyncResult.skipped: EpubSkip[]` (Task 6).
- Produces: per-title copy; `SyncStatus` optionally carries `skippedEpubs?: EpubSkip[]` so the panel (not just a one-shot alert) lists which books aren't syncing.

- [ ] **Step 1: Write failing test** — given a run result with `skipped: [{title:"Deep Work", sizeBytes: 34*1024*1024, reason:"too_large"}]`, `LibrarySync` renders `"‘Deep Work’ (34 MB) is over the 50 MB per-book sync limit and wasn't synced."`; a `storage_full` skip renders the storage copy.

- [ ] **Step 2: Run — expect FAIL** (current copy is item-neutral counts).

- [ ] **Step 3: Implement the copy** (helper formatting bytes → MB; the two `reason` templates from spec §UI). Replace lines 146-147's neutral push with per-skip lines. If persisting in the badge: add `skippedEpubs` to `SyncStatus` (default `[]`), set it in the guarded run that calls `syncEpubs`, and render the list in the panel.

```ts
function skipLine(s: EpubSkip): string {
  const mb = Math.round(s.sizeBytes / (1024 * 1024));
  return s.reason === "too_large"
    ? `‘${s.title}’ (${mb} MB) is over the 50 MB per-book sync limit and wasn’t synced.`
    : `‘${s.title}’ wasn’t synced — you’ve used your 500 MB sync storage. Remove synced books to make room.`;
}
```

- [ ] **Step 4: Extend the `library-sync` Help topic** — add a line: very large books (over 50 MB) may not sync; you’ll see which ones in the sync panel. (DoD coverage gate.)

- [ ] **Step 5: Run — expect PASS.** `npx jest __tests__/components/LibrarySync __tests__/help`.

- [ ] **Step 6: Commit** `feat(sync-ui): explicit per-book over-limit messaging + Help update`.

---

## Task 8: Build provenance — `EXPO_PUBLIC_GIT_SHA`, real About stamp, `[BUILD]` log

**Files:**
- Create: `mobile/src/lib/buildInfo.ts`
- Modify: `mobile/app/(tabs)/about.tsx` (line 38 — the hardcoded `"0.1.0 (MVP)"`), `mobile/app/_layout.tsx` (startup log)
- Test: `mobile/__tests__/lib/buildInfo.test.ts`, `mobile/__tests__/screens/About.test.tsx` (create/extend)

**Interfaces:**
- Consumes: `expo-constants` (already a dep) `Constants.expoConfig?.version`, `?.android?.versionCode` (or `Constants.expoConfig?.runtimeVersion`); `process.env.EXPO_PUBLIC_GIT_SHA` (babel-inlined like `EXPO_PUBLIC_API_BASE_URL`).
- Produces:
  ```ts
  export function buildInfo(): { version: string; versionCode: number | null; sha: string };
  export function buildLabel(): string;         // e.g. "0.2.44 (vc56) · a1b2c3d"
  ```

- [ ] **Step 1: Write failing tests** — `buildInfo()` reads version from a mocked `expo-constants`; `sha` = `process.env.EXPO_PUBLIC_GIT_SHA` when set, `"dev"` when absent; About renders `buildLabel()` (not `"0.1.0 (MVP)"`).

```ts
it("sha falls back to 'dev' when EXPO_PUBLIC_GIT_SHA is unset", () => { ... });
it("sha reflects the baked value", () => { process.env.EXPO_PUBLIC_GIT_SHA = "a1b2c3d"; expect(buildInfo().sha).toBe("a1b2c3d"); });
it("About shows the real version + sha, not the hardcoded MVP string", () => { ... });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `buildInfo.ts`**

```ts
import Constants from "expo-constants";
export function buildInfo() {
  const version = Constants.expoConfig?.version ?? "unknown";
  const versionCode = (Constants.expoConfig as any)?.android?.versionCode ?? null;
  const sha = process.env.EXPO_PUBLIC_GIT_SHA || "dev";
  return { version, versionCode, sha };
}
export function buildLabel(): string {
  const b = buildInfo();
  return `${b.version}${b.versionCode != null ? ` (vc${b.versionCode})` : ""} · ${b.sha}`;
}
```

- [ ] **Step 4: Wire About + startup log**

In `about.tsx` line 38: `<Row label="Version" value={buildLabel()} styles={styles} />`.
In `_layout.tsx` (once, at module/App init): `const b = buildInfo(); console.log(`[BUILD] sha=${b.sha} vc=${b.versionCode} ver=${b.version}`);` — plain metadata only (no secrets).

- [ ] **Step 5: Run — expect PASS.** `npx jest __tests__/lib/buildInfo __tests__/screens/About`.

- [ ] **Step 6: Commit** `feat(build): bake EXPO_PUBLIC_GIT_SHA; real About version/vc/sha + [BUILD] startup log`.

---

## Task 9: Config / deps / build wiring (minSdk 26, native module)

**Files:**
- Modify: `mobile/package.json` (deps), `mobile/app.json` (plugins)
- Test: `mobile/__tests__/app-config.test.ts` (create — assert the plugin is declared)

**Interfaces:**
- Consumes: existing `plugins` array `['expo-router', ['expo-secure-store', {...}], './plugins/withReleaseSigning.js', 'expo-audio']`.
- Produces: `react-native-aes-gcm-crypto` + `expo-build-properties` installed; `app.json` plugins include `["expo-build-properties", { "android": { "minSdkVersion": 26 } }]`.

- [ ] **Step 1: Add deps** — `cd mobile && npx expo install react-native-aes-gcm-crypto expo-build-properties` (use `expo install` for RN-compatible versions). Confirm `react-native-aes-gcm-crypto`'s `encryptFile`/`decryptFile` signature vs Task 3's glue; adjust `epubFileCrypto.ts` if needed.

- [ ] **Step 2: Add the config plugin to `app.json`** (append to `plugins`)

```json
["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
```

- [ ] **Step 3: Write + run a config assertion test** — read `app.json`, assert `expo-build-properties` present with `minSdkVersion: 26`. (Cheap regression against an accidental revert.)

- [ ] **Step 4: Add a jest mock for the native module** — so any suite importing `epubFileCrypto` (or an integration test) doesn't hit a real native module. Add to `mobile/jest.setup.js`:

```js
jest.mock("react-native-aes-gcm-crypto", () => ({
  __esModule: true,
  default: { encryptFile: jest.fn(), decryptFile: jest.fn() },
}));
```

- [ ] **Step 5: `npx tsc --noEmit` + full `npx jest`** — both green.

- [ ] **Step 6: Commit** `chore(build): add react-native-aes-gcm-crypto + expo-build-properties (minSdk 26)`.

---

## Rollout (post-merge, gated in order)

Each gate before the next (spec §Rollout; **backend leads the client**):

1. **Merge to `main`** (all tasks green, full `npx jest`, `tsc`).
2. **Backend refresh** — apply **migration `0026`** on prod (ROOT runbook `Plans/PROD_BACKEND_REFRESH_TO_MAIN.md`; `--no-cache`). Verify `0026` is HEAD and the backfill ran.
3. **nginx PR #125 (25→60 MB)** — apply on the VPS as root on BOTH `location /api/` (mentible.app) and `location /mentible-api/` (mambakkam.net); `nginx -t` + reload. (Still required — 30 MB ciphertext exceeds 25 MB; this was Inc-2's ask and is unapplied.)
4. **Web deploy both surfaces** — `scripts/deploy/web-deploy.sh mentible` then `app` (run in BACKGROUND, not a ≤590s foreground timeout; see the deploy-saga pin). Web keeps `@noble` (un-framed wire), so it needs the new backend.
5. **APK vc56** — bump `app.json` `version` (→ e.g. `0.2.44`) + `android.versionCode` (55 → 56); **full native rebuild** (new native module + minSdk 26 → prebuild); build with `EXPO_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)` alongside `EXPO_PUBLIC_API_BASE_URL=https://mentible.app`. Release-signed (CN=Mentible). GitHub Release `mentible-0.2.44-vc56` on mambakkam-net (Latest + stable `Mentible.apk`).

## Device-verify (the correctness gate — from spec §Testing ★)

Run via `mobile:verify` skill on a real build:
1. **Provenance first:** read the running app's `[BUILD] sha=…` from logcat; assert it equals the APK's `git rev-parse --short HEAD`. Mismatch → abort (you tested a stale build).
2. **Native path end-to-end:** import a 30 MB EPUB → `sealEpubFileNative` → `putEpubFile` (streamed) → on a second device/account `getEpubToFile` → `openEpubFileNative` → `saveEpubFileNative` → **open the pulled book**. Crypto should be sub-second, no jank.
3. **Cross-device convergence:** push on A, pull on B, confirm B does NOT re-push (compiledAt threaded).
4. **Over-limit UX:** a >50 MB EPUB surfaces the explicit "‘<title>’ (N MB) is over the 50 MB per-book limit" message (not a silent skip).

## Self-review notes (writing-plans §Self-Review)

- **Spec coverage:** every spec section maps to a task — crypto seam (T3), storage (T4), client sync T5/T6, backend 0026+router T1/T2, config/build T9, UI T7, build provenance T8, testing (per-task + device-verify), rollout (above). ✓
- **Spec-gap surfaced (not in the spec):** backfilled Inc-2 rows whose `meta_ciphertext` still holds a `coverSvg` exceed the `X-Meta` header budget → Task 2 Step 4 adds a `409 "re-sync required"` guard (near-zero prod rows; a fresh 2.1 push writes a tiny meta). Confirm with the user this is acceptable vs. a one-off re-encrypt (impossible server-side under zero-knowledge).
- **Design deviation (justified):** the spec sketches one `epubCrypto.ts` exporting native + web fns; realized as a platform-split (`epubFileCrypto.ts` (native base) + `.web.ts` (stub)) so the native module never enters the web bundle (`reference_expo_filesystem_not_on_web`). Same interface, safer bundling.
- **Type consistency:** `EpubSyncResult.skipped` changes `string[]` → `EpubSkip[]` — every consumer (`LibrarySync`, any `SyncStatus` aggregation) updated in T6/T7. `EpubBlobHeaders` gains `tag` + `metaCt` (T5) — every caller updated in T6.
- **Version drift:** plan uses real `0.2.43/vc55` → `vc56`, not the spec's stale `vc48`.
