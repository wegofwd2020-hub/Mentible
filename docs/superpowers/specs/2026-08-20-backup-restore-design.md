# Library Backup & Restore — Design Spec

**Status:** Proposed · **Date:** 2026-08-20 · **Area:** `mobile/src/storage`, `mobile/app/(tabs)/settings.tsx` · **Motivation:** the domain migration (mambakkam.net → mentible.app) exposed that the library is **per-origin browser storage with no cloud sync** — every user loses their library on an origin/device move. This adds a portable **whole-library backup file** + a **restore** importer, so any user can carry their library across origins/devices. Doubles as a real backup feature.

## Why (and what it replaces)

There is no server-side library (ADR-014 cloud sync is unbuilt; the account holds only identity). During the mentible.app cutover, one account's library had to be hand-migrated via a `window.name` console bridge — which works for the small authored-book store (~1.3 MB) but **cannot** carry the reader-library EPUBs (26 MB, incl. a 21.7 MB imported EPUB): `window.name`/clipboard are too small and `javascript_tool` times out on multi-MB reads. A **file-based** backup handles any size and needs no console. This is the reusable "process to migrate other users" ([[reference_web_library_storage_and_migration]]).

**Not a replacement for cloud sync.** ADR-014 (zero-knowledge cloud library sync) remains the strategic fix that makes migration automatic + cross-device. Backup/Restore is the pragmatic, always-useful stopgap (and a genuine backup/device-transfer feature in its own right).

## What's local (the two libraries + settings)

- **Authored books** — `bookStore`: `localStorage['sbq_book_index']` (list) + IndexedDB `sbq_books`/`books` (per-book JSON; media embedded as `data:` URIs on web). API: `loadBookIndex()`, `loadBook(id)`, `saveBook(book)`.
- **Reader library (saved/imported EPUBs)** — `epubLibrary`: IndexedDB `sbq`/`epubs` (record = `EpubMeta` + `blob`, keyPath `id`, where **`id === bookId`**). API: `listEpubs()`, `saveEpub({bookId,title,bytes,coverSvg?,...})`, plus a NEW `getEpubBytes(id)` reader (this slice adds it).
- **Settings** — `shelfStore` (`sbq_shelves`, `sbq_shelf_assignments`), default gen-params (`sbq_default_gen_params` via `settingsStore`), feed prefs (`sbq_feed_sources`, `sbq_open_shelves_prefs`).
- **Excluded from backup:** `sbq_byok_key` (the BYOK API key — origin-local by design; re-enter in Settings), `sbq_seeded_*` (seed flags), `sbq_usage_ledger` (local metering), `sbq_export_status`, `sbq_feed_entries_*` (regenerable cache).

## Decisions

- **D1 — One portable file: `.mentible-backup`** (a zip via `fflate`, already used by `bookBundle.ts`). Layout:
  - `manifest.json` — `{ _fmt:"mentible-backup", _v:1, createdAt, appVersion, counts:{books,epubs} }`
  - `books/<bookId>.json` — each authored `Book` (verbatim `loadBook` output)
  - `epubs/index.json` — the `EpubMeta[]` (title, bookId, coverSvg, createdAt, sizes…)
  - `epubs/<id>.epub` — each reader EPUB's raw bytes
  - `settings.json` — `{ shelves, assignments, genParams, feedSources, openShelvesPrefs }`
- **D2 — Full scope** (chosen): authored books + reader EPUBs + shelves/assignments/gen-params/feed-prefs. (The reader EPUBs are the whole point — imported externals like *Land of Lisp* have no other source.)
- **D3 — Restore = OVERWRITE on id collision** (chosen): the backup wins. `saveBook(book)` upserts by `book.id` (overwrites + reconciles the index); `saveEpub` writes with `id===bookId` (overwrites the record); settings keys are written wholesale (backup's shelves/assignments/prefs replace local). A restore of the same file is idempotent (same ids overwrite to the same values). **Because overwrite is destructive of local edits, restore shows a confirm dialog first** ("Import N books + M EPUBs, overwriting any with the same id?").
- **D4 — Cross-platform I/O, reusing existing patterns.** Export: web → download a Blob (anchor, like `bookBundle`); native → write to `FileSystem.documentDirectory` + `expo-sharing`. Import: web → a file `<input>`; native → `expo-document-picker` (reuse `pickBookFile.ts`). The storage put-fns (`saveBook`/`saveEpub`/`shelfStore`) already branch web-IDB vs native-FS — the backup module stays platform-agnostic above them.
- **D5 — UI in Settings.** A new "Backup & Restore" section on `app/(tabs)/settings.tsx`: an **Export library** button (builds the file, downloads/shares it, shows counts) and a **Restore from backup** button (pick file → confirm → import → report "imported N books, M EPUBs; overwrote K"). Errors via `@/lib/alert`. Available wherever Settings is (the data is local, not account-scoped).
- **D6 — Robust, non-aborting import.** A malformed zip / wrong `_fmt` → a clear error, no partial write. A single bad entry (unparseable book, oversize) → skip with a collected warning, continue (mirror `bookBundle`'s partial-import discipline). Never trust the bundle's ids for a filesystem path (no path-traversal — ids are used as IndexedDB keys / logical ids, not file paths, but validate they're strings).
- **D7 — Help DoD:** a `backup-restore` FEATURES key + topic + tree leaf (what it backs up, what it excludes — the API key, that restore overwrites same-id items).

## Architecture (touch-points)

- **New:** `mobile/src/storage/backupRestore.ts` — `buildBackup(): Promise<{ bytes: Uint8Array; filename: string; counts }>` (gathers everything, `zipSync`) and `restoreBackup(bytes: Uint8Array): Promise<{ books:number; epubs:number; overwritten:number; warnings:string[] }>` (`unzipSync`, overwrite-writes). Pure over the storage APIs — unit-testable with mocked stores.
- **Modify:** `mobile/src/storage/epubLibrary.ts` — add `getEpubBytes(id: string): Promise<ArrayBuffer | null>` (web: read the record's blob → arrayBuffer; native: read the file). Needed to export EPUB bytes (today only `openEpub` downloads them).
- **New:** `mobile/src/components/BackupRestore.tsx` — the Settings section (Export + Restore buttons + result state + confirm), plus the platform file glue (or a small `mobile/src/lib/backupFile.ts` for download/share/pick, reusing `pickBookFile`/`bookBundle` patterns).
- **Modify:** `app/(tabs)/settings.tsx` — mount `<BackupRestore/>`.
- **Help:** `features.ts`, `topics.ts`, `tree.ts`.
- **Reuse unchanged:** `fflate`, `bookStore`, `saveEpub`, `shelfStore`, `settingsStore`, `pickBookFile`.

## Non-goals

- **No cloud/server involvement** — the file is entirely client-side; the backend is untouched.
- **No account binding** — a backup isn't tied to a Supabase user; it's the local library. (Restoring someone else's backup would import their books — acceptable; it's a local file the user chose.)
- **No selective/partial backup UI** (pick individual books) — it's all-or-nothing this slice. Per-book export already exists (`ExportBookJsonButton`, `.book.zip`).
- **No API-key migration** — deliberately excluded (re-enter).
- **No automatic/scheduled backups** — manual, user-initiated.
- **No merge/diff UI** — overwrite-on-collision is the fixed policy (D3).

## Testing

- **buildBackup:** with mocked stores holding N books + M epubs + shelves/prefs → returns a zip whose `unzipSync` has `manifest.json` (counts N/M), `books/<id>.json` per book, `epubs/index.json` + `epubs/<id>.epub` per epub, `settings.json` with shelves/assignments/genParams/feedPrefs. **Asserts the API key is NOT present** anywhere in the bundle.
- **restoreBackup (overwrite):** a bundle → `saveBook` called per book, `saveEpub` per epub (with original bookId), settings keys written; a pre-existing same-id book is OVERWRITTEN (not duplicated, not skipped); returns correct counts. Round-trip: `restoreBackup(buildBackup())` reproduces the library.
- **Robustness:** a non-zip / wrong `_fmt` → throws a clear error, no writes; a single malformed `books/*.json` → skipped with a warning, the rest import; empty library → a valid (empty) bundle.
- **getEpubBytes:** returns the stored bytes (web blob → ArrayBuffer); `null` for a missing id.
- **UI (RNTL):** Export button calls `buildBackup` + triggers the file save; Restore picks a file, shows the confirm, and on confirm calls `restoreBackup` + reports counts; a wrong file surfaces an alert; cancel does nothing.
- **Device-verify (native, per `mobile:verify`):** export on the emulator → a `.mentible-backup` shares out; import it back on a fresh install → books + EPUBs + shelves restored.
- **Real cross-origin migration (the motivating case):** export on mambakkam.net/app/mentible → restore on mentible.app → all authored books + all 4 reader EPUBs (incl. the 21.7 MB Land of Lisp) + shelves present. (Manual, post-merge.)

## Rollout

Mobile-only (web + native); no backend/migration. Web deploy + APK. First real use: migrate the reader EPUBs that the `window.name` bridge couldn't (26 MB), then it's the standing answer for any user's origin/device move — until ADR-014 cloud sync supersedes it.
