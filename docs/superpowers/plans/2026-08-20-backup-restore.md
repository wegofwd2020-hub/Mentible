# Library Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A portable whole-library backup file (`.mentible-backup`) + a restore importer, so a user can carry their library (authored books + reader EPUBs + shelves/prefs) across origins/devices.

**Architecture:** A pure `backupRestore.ts` module (`buildBackup`/`restoreBackup`) that zips/unzips via `fflate` over the existing storage APIs (`bookStore`, `epubLibrary`, `AsyncStorage` settings keys), plus a `getEpubBytes` reader on `epubLibrary`, a Settings "Backup & Restore" section, and Help. Restore OVERWRITES on id-collision. Cross-platform; no backend.

**Tech Stack:** React Native + Expo, TypeScript, `fflate` (already a dep), `@react-native-async-storage/async-storage`, `expo-file-system`/`expo-document-picker` (native), Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-20-backup-restore-design.md`

## Global Constraints

- **Reuse the shipped storage APIs.** `loadBookIndex()`/`loadBook(id)`/`saveBook(book)` (bookStore), `listEpubs()`/`saveEpub(SaveEpubInput)` + the new `getEpubBytes(id)` (epubLibrary), `AsyncStorage` for the settings keys. Do NOT reach into IndexedDB directly outside `epubLibrary`.
- **Overwrite on id-collision** (D3): `saveBook` upserts by `book.id`; `saveEpub` writes with `id===bookId` (overwrites); settings keys are set wholesale (backup value replaces local). Count "overwritten" for the report. Restore is idempotent.
- **Exclude from the bundle:** `sbq_byok_key` (API key), `sbq_seeded_*`, `sbq_usage_ledger`, `sbq_export_status`, `sbq_feed_entries_*`. A test asserts the API key never appears in the bundle.
- **Cross-platform via existing helpers.** Save the file with `downloadArtifact(bytes, filename, mime)` (web download / native FS). Read an imported file to `Uint8Array` via a small platform helper (web `<input>`/`File`, native `expo-document-picker` — mirror `pickBookFile.ts`).
- **Robust, non-aborting restore** (D6): wrong `_fmt`/non-zip → throw a clear error with NO writes; a single bad entry → skip + collect a warning, continue. Validate ids are strings; never use them as filesystem paths.
- **fflate byte-safety:** a `Uint8Array` from `unzipSync` may have a non-zero `byteOffset` — copy before handing to `saveEpub` (`Uint8Array.from(f).buffer`, not `f.buffer`). `bookBundle.ts` has the same note.
- **Help DoD (CI coverage + tree gates):** a `backup-restore` FEATURES key + topic + tree leaf in the same branch.
- **Mobile-only.** No backend/migration/compiler change.

## File Structure

- **Create:** `mobile/src/storage/backupRestore.ts` (`buildBackup`, `restoreBackup`), `mobile/src/lib/backupFile.ts` (platform file save + pick → `Uint8Array`), `mobile/src/components/BackupRestore.tsx` (Settings section).
- **Modify:** `mobile/src/storage/epubLibrary.ts` (add `getEpubBytes`), `mobile/app/(tabs)/settings.tsx` (mount `<BackupRestore/>`), Help content files.
- **Tests:** `mobile/__tests__/storage/backupRestore.test.ts`, `mobile/__tests__/storage/epubLibrary.getbytes.test.ts` (or extend existing), `mobile/__tests__/components/BackupRestore.test.tsx`, help coverage.

---

## Task 1: `getEpubBytes` on epubLibrary

**Files:**
- Modify: `mobile/src/storage/epubLibrary.ts`
- Test: `mobile/__tests__/storage/epubLibrary.getbytes.test.ts`

**Interfaces:**
- Consumes: the file's `isWeb`, `tx`, `WebRecord`, `epubPath`, `fromBase64` (from `@/storage/pickBookFile` — confirm its export + return type; it's used by `bookBundle.ts`).
- Produces: `getEpubBytes(id: string): Promise<ArrayBuffer | null>`.

- [ ] **Step 1: Write the failing test** (mock the web path)

```ts
// mobile/__tests__/storage/epubLibrary.getbytes.test.ts
// jsdom + fake-indexeddb env (the repo already uses fake-indexeddb for epubLibrary web tests — mirror that setup).
import { saveEpub, getEpubBytes } from "@/storage/epubLibrary";

it("getEpubBytes returns the stored bytes for a saved epub, null for a missing id", async () => {
  const bytes = new Uint8Array([1,2,3,4,5]).buffer;
  await saveEpub({ bookId: "b1", title: "T", bytes });
  const out = await getEpubBytes("b1");
  expect(out).not.toBeNull();
  expect(new Uint8Array(out!)).toEqual(new Uint8Array([1,2,3,4,5]));
  expect(await getEpubBytes("nope")).toBeNull();
});
```

- [ ] **Step 2: Run, verify failure** — `cd mobile && npx jest epubLibrary.getbytes` → FAIL (not exported).

- [ ] **Step 3: Implement** — add beside the other public fns (delegates web/native):

```ts
// Read an EPUB's raw bytes (for Backup export). Web: the IndexedDB blob →
// ArrayBuffer. Native: the on-disk .epub → ArrayBuffer. null if absent.
export async function getEpubBytes(id: string): Promise<ArrayBuffer | null> {
  if (isWeb) {
    const rec = await tx<WebRecord | undefined>("readonly", (s) => s.get(id));
    return rec ? await rec.blob.arrayBuffer() : null;
  }
  const p = epubPath(id);
  const info = await FileSystem.getInfoAsync(p);
  if (!info.exists) return null;
  const b64 = await FileSystem.readAsStringAsync(p, { encoding: FileSystem.EncodingType.Base64 });
  const u8 = fromBase64(b64); // Uint8Array (confirm pickBookFile's return type)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}
```
(Add `import { fromBase64 } from "@/storage/pickBookFile";` if not present. If `fromBase64` returns a Buffer/ArrayBuffer instead of Uint8Array, adapt the `.buffer` handling.)

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest epubLibrary && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(storage): getEpubBytes — read an EPUB's raw bytes for backup export"`

---

## Task 2: `buildBackup` — gather + zip

**Files:**
- Create: `mobile/src/storage/backupRestore.ts`
- Test: `mobile/__tests__/storage/backupRestore.test.ts`

**Interfaces:**
- Consumes: `loadBookIndex`/`loadBook` (bookStore), `listEpubs`/`getEpubBytes` (epubLibrary, T1), `AsyncStorage`, `zipSync`/`strToU8` (fflate).
- Produces: `buildBackup(): Promise<{ bytes: Uint8Array; filename: string; counts: { books: number; epubs: number } }>`.

- [ ] **Step 1: Write the failing tests** (mock the stores + AsyncStorage)

```ts
// mobile/__tests__/storage/backupRestore.test.ts
import { unzipSync, strFromU8 } from "fflate";
import { buildBackup } from "@/storage/backupRestore";

jest.mock("@/storage/bookStore", () => ({
  loadBookIndex: jest.fn(async () => [{ id: "b1", title: "One" }]),
  loadBook: jest.fn(async (id: string) => ({ id, title: "One", toc: { subjects: [] }, content: {} })),
  saveBook: jest.fn(async () => {}),
}));
jest.mock("@/storage/epubLibrary", () => ({
  listEpubs: jest.fn(async () => [{ id: "b1", title: "One", sizeBytes: 3, compiledAt: "x" }]),
  getEpubBytes: jest.fn(async () => new Uint8Array([9,9,9]).buffer),
  saveEpub: jest.fn(async () => ({})),
}));
const store: Record<string,string> = { sbq_shelves: '[{"id":"s1"}]', sbq_byok_key: "SECRET-KEY" };
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => { store[k]=v; }),
  },
}));

it("builds a zip with manifest, books, epubs, settings — and NO api key", async () => {
  const { bytes, counts } = await buildBackup();
  expect(counts).toEqual({ books: 1, epubs: 1 });
  const z = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(z["manifest.json"]));
  expect(manifest._fmt).toBe("mentible-backup");
  expect(manifest.counts).toEqual({ books: 1, epubs: 1 });
  expect(z["books/b1.json"]).toBeTruthy();
  expect(JSON.parse(strFromU8(z["epubs/index.json"]))[0].id).toBe("b1");
  expect(Array.from(z["epubs/b1.epub"])).toEqual([9,9,9]);
  const settings = JSON.parse(strFromU8(z["settings.json"]));
  expect(settings.sbq_shelves).toBe('[{"id":"s1"}]');
  // CRITICAL: the API key must never be in the bundle
  const whole = Object.values(z).map(strFromU8).join("");
  expect(whole).not.toContain("SECRET-KEY");
  expect(settings.sbq_byok_key).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify failure** — FAIL (module missing).

- [ ] **Step 3: Implement** `buildBackup`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { loadBookIndex, loadBook, saveBook } from "@/storage/bookStore";
import { listEpubs, getEpubBytes, saveEpub, type EpubMeta } from "@/storage/epubLibrary";

// Settings keys carried in a backup — raw AsyncStorage values, restored wholesale.
// DELIBERATELY EXCLUDES sbq_byok_key (API key), sbq_seeded_*, sbq_usage_ledger,
// sbq_export_status, sbq_feed_entries_* (regenerable / secret / per-origin).
const SETTINGS_KEYS = [
  "sbq_shelves", "sbq_shelf_assignments", "sbq_default_gen_params",
  "sbq_feed_sources", "sbq_open_shelves_prefs",
] as const;

export const BACKUP_FMT = "mentible-backup";

export async function buildBackup(): Promise<{ bytes: Uint8Array; filename: string; counts: { books: number; epubs: number } }> {
  const files: Record<string, Uint8Array> = {};

  const index = await loadBookIndex();
  let books = 0;
  for (const m of index) {
    const b = await loadBook(m.id);
    if (b) { files[`books/${m.id}.json`] = strToU8(JSON.stringify(b)); books++; }
  }

  const epubMetas = await listEpubs();
  const epubs: EpubMeta[] = [];
  for (const m of epubMetas) {
    const bytes = await getEpubBytes(m.id);
    if (bytes) { files[`epubs/${m.id}.epub`] = new Uint8Array(bytes); epubs.push(m); }
  }
  files["epubs/index.json"] = strToU8(JSON.stringify(epubs));

  const settings: Record<string, string> = {};
  for (const k of SETTINGS_KEYS) { const v = await AsyncStorage.getItem(k); if (v !== null) settings[k] = v; }
  files["settings.json"] = strToU8(JSON.stringify(settings));

  files["manifest.json"] = strToU8(JSON.stringify({
    _fmt: BACKUP_FMT, _v: 1, createdAt: new Date().toISOString(),
    counts: { books, epubs: epubs.length },
  }));

  const bytes = zipSync(files);
  const stamp = new Date().toISOString().slice(0, 10);
  return { bytes, filename: `mentible-backup-${stamp}.mentible-backup`, counts: { books, epubs: epubs.length } };
}
```

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest backupRestore && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(backup): buildBackup — zip the library (books+epubs+settings), excludes API key"`

---

## Task 3: `restoreBackup` — unzip + overwrite-write

**Files:**
- Modify: `mobile/src/storage/backupRestore.ts`
- Test: `mobile/__tests__/storage/backupRestore.test.ts` (extend)

**Interfaces:**
- Produces: `restoreBackup(bytes: Uint8Array): Promise<{ books: number; epubs: number; overwritten: number; warnings: string[] }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to backupRestore.test.ts
import { restoreBackup, buildBackup } from "@/storage/backupRestore";
import { saveBook } from "@/storage/bookStore";
import { saveEpub } from "@/storage/epubLibrary";

it("round-trips: restoreBackup(buildBackup()) writes books + epubs + settings", async () => {
  const { bytes } = await buildBackup();
  (saveBook as jest.Mock).mockClear(); (saveEpub as jest.Mock).mockClear();
  const res = await restoreBackup(bytes);
  expect(res.books).toBe(1);
  expect(res.epubs).toBe(1);
  expect(saveBook).toHaveBeenCalledWith(expect.objectContaining({ id: "b1" }));
  expect(saveEpub).toHaveBeenCalledWith(expect.objectContaining({ bookId: "b1", title: "One" }));
});

it("rejects a non-backup zip with no writes", async () => {
  const { zipSync, strToU8 } = require("fflate");
  const junk = zipSync({ "manifest.json": strToU8(JSON.stringify({ _fmt: "something-else" })) });
  (saveBook as jest.Mock).mockClear();
  await expect(restoreBackup(junk)).rejects.toThrow();
  expect(saveBook).not.toHaveBeenCalled();
});

it("skips a single malformed book entry with a warning, imports the rest", async () => {
  const { zipSync, strToU8 } = require("fflate");
  const z = zipSync({
    "manifest.json": strToU8(JSON.stringify({ _fmt: "mentible-backup", _v: 1 })),
    "books/good.json": strToU8(JSON.stringify({ id: "good", title: "G", toc: { subjects: [] }, content: {} })),
    "books/bad.json": strToU8("{ not json"),
    "epubs/index.json": strToU8("[]"),
  });
  const res = await restoreBackup(z);
  expect(res.books).toBe(1);
  expect(res.warnings.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement** `restoreBackup` (append to the module):

```ts
export async function restoreBackup(bytes: Uint8Array): Promise<{ books: number; epubs: number; overwritten: number; warnings: string[] }> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new Error("This file isn't a valid Mentible backup (couldn't unzip)."); }
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(entries["manifest.json"] ?? new Uint8Array())); } catch { manifest = null; }
  if (!manifest || manifest._fmt !== BACKUP_FMT) throw new Error("This file isn't a Mentible backup.");

  const warnings: string[] = [];
  let books = 0, epubs = 0, overwritten = 0;
  const existingBookIds = new Set((await loadBookIndex()).map((m) => m.id));
  const existingEpubIds = new Set((await listEpubs()).map((m) => m.id));

  // Books
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith("books/") || !name.endsWith(".json")) continue;
    try {
      const book = JSON.parse(strFromU8(data));
      if (!book || typeof book.id !== "string") { warnings.push(`Skipped ${name}: not a book.`); continue; }
      if (existingBookIds.has(book.id)) overwritten++;
      await saveBook(book);
      books++;
    } catch { warnings.push(`Skipped ${name}: unreadable.`); }
  }

  // EPUBs (from epubs/index.json + epubs/<id>.epub)
  let epubIndex: EpubMeta[] = [];
  try { epubIndex = JSON.parse(strFromU8(entries["epubs/index.json"] ?? strToU8("[]"))); } catch { epubIndex = []; }
  for (const m of epubIndex) {
    const f = entries[`epubs/${m.id}.epub`];
    if (!f) { warnings.push(`Skipped EPUB ${m.id}: bytes missing.`); continue; }
    try {
      if (existingEpubIds.has(m.id)) overwritten++;
      const buf = Uint8Array.from(f).buffer; // copy — unzipSync views may have a byteOffset
      await saveEpub({ bookId: m.id, title: m.title, bytes: buf, ...(m.coverSvg ? { coverSvg: m.coverSvg } : {}) });
      epubs++;
    } catch { warnings.push(`Skipped EPUB ${m.id}: write failed.`); }
  }

  // Settings — wholesale overwrite (backup wins)
  try {
    const settings = JSON.parse(strFromU8(entries["settings.json"] ?? strToU8("{}")));
    for (const [k, v] of Object.entries(settings)) {
      if (SETTINGS_KEYS.includes(k as any) && typeof v === "string") await AsyncStorage.setItem(k, v);
    }
  } catch { warnings.push("Settings block unreadable; shelves/prefs not restored."); }

  return { books, epubs, overwritten, warnings };
}
```

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest backupRestore && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(backup): restoreBackup — overwrite-import books+epubs+settings, robust"`

---

## Task 4: Settings UI + file glue

**Files:**
- Create: `mobile/src/lib/backupFile.ts`, `mobile/src/components/BackupRestore.tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`
- Test: `mobile/__tests__/components/BackupRestore.test.tsx`

**Interfaces:**
- Consumes: `buildBackup`/`restoreBackup`, `downloadArtifact` (`@/storage/epubLibrary`), `Alert` (`@/lib/alert`), the Settings section styles.
- Produces: `pickBackupFile(): Promise<Uint8Array | null>` + `saveBackupFile(bytes, filename)` in `backupFile.ts`; `<BackupRestore/>`.

- [ ] **Step 1: Write the failing tests** (RNTL; mock backupRestore + backupFile + Alert)

```tsx
// mobile/__tests__/components/BackupRestore.test.tsx
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { BackupRestore } from "@/components/BackupRestore";

const build = jest.fn(async () => ({ bytes: new Uint8Array([1]), filename: "x.mentible-backup", counts: { books: 2, epubs: 1 } }));
const restore = jest.fn(async () => ({ books: 2, epubs: 1, overwritten: 0, warnings: [] }));
jest.mock("@/storage/backupRestore", () => ({ buildBackup: () => build(), restoreBackup: (b: any) => restore(b) }));
const save = jest.fn(async () => ({})); const pick = jest.fn(async () => new Uint8Array([1]));
jest.mock("@/lib/backupFile", () => ({ saveBackupFile: (...a: any) => save(...a), pickBackupFile: () => pick() }));
const alertSpy = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: any) => alertSpy(...a) } }));

beforeEach(() => { build.mockClear(); restore.mockClear(); save.mockClear(); pick.mockClear(); alertSpy.mockClear(); });

it("Export builds + saves the file", async () => {
  const { getByText } = render(<BackupRestore />);
  fireEvent.press(getByText(/export library/i));
  await waitFor(() => expect(build).toHaveBeenCalled());
  expect(save).toHaveBeenCalled();
});

it("Restore picks a file, confirms, then imports + reports", async () => {
  const { getByText } = render(<BackupRestore />);
  fireEvent.press(getByText(/restore from backup/i));
  await waitFor(() => expect(pick).toHaveBeenCalled());
  // confirm dialog fires (Alert with buttons) — simulate the confirm callback
  const confirmBtn = alertSpy.mock.calls.find(c => Array.isArray(c[2]))?.[2]?.find((b: any) => /import|restore|continue/i.test(b.text));
  await confirmBtn.onPress();
  await waitFor(() => expect(restore).toHaveBeenCalled());
});

it("a non-backup file surfaces an error and does not import", async () => {
  restore.mockRejectedValueOnce(new Error("not a backup"));
  pick.mockResolvedValueOnce(new Uint8Array([9]));
  const { getByText } = render(<BackupRestore />);
  fireEvent.press(getByText(/restore from backup/i));
  await waitFor(() => expect(pick).toHaveBeenCalled());
  const confirmBtn = alertSpy.mock.calls.find(c => Array.isArray(c[2]))?.[2]?.find((b: any) => /import|restore|continue/i.test(b.text));
  await confirmBtn.onPress();
  await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/couldn.t|error|failed/i), expect.anything()));
});
```

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement**
  - `mobile/src/lib/backupFile.ts`:
    - `saveBackupFile(bytes: Uint8Array, filename: string)` → `downloadArtifact(bytes.buffer, filename, "application/zip")` (web downloads; native writes to documentDirectory — optionally `Sharing.shareAsync` the path if `expo-sharing` is available, else just return the path).
    - `pickBackupFile(): Promise<Uint8Array | null>` → web: a programmatic `<input type=file>` → read `arrayBuffer()` → `Uint8Array`; native: `DocumentPicker.getDocumentAsync({ type: ["application/zip","application/octet-stream","*/*"] })` → read the uri as base64 → `fromBase64`. Mirror `pickBookFile.ts` exactly for the native path.
  - `mobile/src/components/BackupRestore.tsx` — a Settings section: a title "Backup & Restore", an **Export library** button (`onExport`: `busy` guard → `const b = await buildBackup(); await saveBackupFile(b.bytes, b.filename); Alert.alert("Backup saved", `${b.counts.books} book(s) + ${b.counts.epubs} EPUB(s).`)`), a **Restore from backup** button (`onRestore`: `const bytes = await pickBackupFile(); if(!bytes) return;` → `Alert.alert("Restore?", "This overwrites any book/EPUB with the same id.", [{text:"Cancel"},{text:"Import", onPress: async()=>{ try { const r = await restoreBackup(bytes); Alert.alert("Restored", `${r.books} book(s), ${r.epubs} EPUB(s)${r.overwritten?`, ${r.overwritten} overwritten`:""}.${r.warnings.length?` ${r.warnings.length} skipped.`:""} Reload to see them.`);} catch(e){ Alert.alert("Couldn't restore", e instanceof Error ? e.message : "Not a valid backup."); } }}])`), and a note: "Backs up your books, saved EPUBs, shelves, and settings — not your API key. Restore overwrites items with the same id." Use `@/lib/alert`; `busy` disables both buttons during work.
  - Mount `<BackupRestore/>` in `app/(tabs)/settings.tsx` as a new section (read the file to place it alongside the existing sections; keep the same section styling).

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest BackupRestore && npx tsc --noEmit`. Confirm the settings screen still renders.
- [ ] **Step 5: Commit** — `git commit -m "feat(backup): Backup & Restore Settings section + cross-platform file glue"`

---

## Task 5: Help topic + tree leaf

**Files:**
- Modify: `mobile/src/help-content/{features.ts,topics.ts,tree.ts}`
- Test: `mobile/__tests__/help/coverage.test.ts` + tree gate

**Interfaces:** copy an existing feature's shape (e.g. `narrate-topic`).

- [ ] **Step 1** Add `backup-restore` to `FEATURES`.
- [ ] **Step 2** Add a `HelpTopic` with `featureKey:"backup-restore"`: what a backup contains (authored books, saved reader EPUBs, shelves, generation settings), what it EXCLUDES (your API key — re-enter after restore), that Restore overwrites items with the same id, and that it's the way to move your library to a new device or the new mentible.app site. Accurate to shipped behavior.
- [ ] **Step 3** Add a `HELP_TREE` leaf under the Settings/library branch (node id distinct from the topicId).
- [ ] **Step 4** `cd mobile && npx jest --testPathPattern=help` → coverage + tree gates pass.
- [ ] **Step 5** Commit `docs(help): backup-restore topic + tree leaf`.

---

## Self-Review

- **Spec coverage:** D1 format → T2/T3; D2 full scope → T2 (books+epubs+settings); D3 overwrite → T3 (`saveBook`/`saveEpub` upsert, `overwritten` count, confirm dialog in T4); D4 cross-platform I/O → T4 (`backupFile`); D5 Settings UI → T4; D6 robustness → T3 tests; D7 Help → T5; `getEpubBytes` → T1. Covered.
- **Type consistency:** `buildBackup()→{bytes,filename,counts}`, `restoreBackup(bytes)→{books,epubs,overwritten,warnings}`, `getEpubBytes(id)→ArrayBuffer|null`, `SaveEpubInput{bookId,title,bytes,coverSvg?}` — all match callers. `SETTINGS_KEYS` shared by build+restore (single source).
- **Placeholder scan:** the two "confirm/adapt" notes are real repo checks — `fromBase64`'s return type (T1) and where to mount the section in `settings.tsx` (T4). No fabricated APIs.
- **Risk note:** the RNTL confirm-dialog simulation in T4 depends on `@/lib/alert`'s `Alert.alert(title, msg, buttons)` shape — read `@/lib/alert` and match how other components (e.g. NarrationPanel) drive its buttons in tests.
