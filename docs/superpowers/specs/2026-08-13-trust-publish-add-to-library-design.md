# Trust Publish "Add to Library" actually lands in Library — Design

**Status:** Approved (brainstorming, 2026-08-13). Bug fix.

## Bug

In the trust workspace (Projects) Publish step, **"Add to Library"** calls `saveBook(book)` →
the **`bookStore`** (the store the **Studio** tab lists via `loadBookIndex`), then alerts
*"Added to your Library."* But the **Library** tab (`app/(tabs)/library.tsx:146`) lists
**`listEpubs()`** — compiled **EPUB** artifacts from the **`epubLibrary`** store. So the book lands in
**Studio**, never in **Library**; the success alert is wrong. Reported by the user: created a book via
Projects, approved, "Add to Library" → not in Library, but present + openable in Studio.

Both trust Publish handlers have it (`app/trust/[projectId].tsx`):
- `onPublishToLibrary` (assembled whole book, per-topic Publish mode).
- `onAddToLibrary(versionId, title, format)` (per-artifact, whole-book Publish mode).

## Correct reference

Studio's **"Save to Library (EPUB3)"** (`src/components/SaveToLibraryButton.tsx`) does it right:
`trackedExport(book, "epub", { diagrams: true })` → cover via `exportBook(book, { format: "cover" })`
(best-effort) → **`saveEpub({ bookId, title, bytes, coverBytes })`** (`src/storage/epubLibrary.ts`) — the
store `listEpubs()` (Library) reads.

## Fix

Make both trust Publish "Add to Library" handlers compile + `saveEpub` so the book reaches the Library,
**while keeping `saveBook`** so it *also* stays in Studio (the user explicitly liked the Studio copy).

Per handler, after assembling the `book` (`assembleBook()` / `artifactToBook(...)`):
```ts
await saveBook(book);                                   // keep — Studio (loadBookIndex)
const { artifact: bytes } = await trackedExport(book, "epub", { diagrams: true });
let coverBytes: ArrayBuffer | undefined;
try { coverBytes = (await exportBook(book, { format: "cover" })).artifact; } catch { coverBytes = undefined; }
await saveEpub({ bookId: book.id, title: book.title, bytes, coverBytes });
Alert.alert("Added", "Added to your Library.");
```
- Reuse the existing `pubBusy` state; the compile (diagrams → SVG) is **minutes-long**, so update the
  button/label to read **"Compiling EPUB…"** while `pubBusy` is set (mirror `SaveToLibraryButton`'s
  "Rendering diagrams + compiling EPUB…"), so the user knows it's working, not hung.
- Error handling: `trackedExport`/`exportBook` can 402 (Pro-wall) or 429/422/5xx. Route a 402 to the
  existing upgrade prompt (`onDownloadError` already handles 402); other errors → the existing
  "Couldn't add" alert with the server message. Do NOT claim "Added" if the EPUB compile failed.
- **Pro-gating (RESOLVED — consistent, not a regression):** compiling an EPUB goes through the export
  submit, which **is** Pro-gated (402 for Free). Studio's `SaveToLibraryButton` uses the exact same
  `trackedExport` → also 402s a Free user. So trust "Add to Library" becomes Pro-gated **the same way
  Studio already is** — consistent, not a new inconsistency. A Free user gets the **upgrade prompt** (route
  the 402 through the existing `onDownloadError`/upgrade path); a Pro user (e.g. Managed Unlimited) saves
  fine. This does NOT touch "publish stays free": that is the **separate** public-catalog action
  `POST /library/{book_id}/publish` (`backend/src/library/router.py`), not device Library-save. No conflict.

## Testing

- Screen/handler test (RNTL) for `onPublishToLibrary` and `onAddToLibrary`: mock `assembleBook`/
  `artifactToBook`, `saveBook`, `trackedExport` (→ bytes), `exportBook` (cover), `saveEpub`. Assert: on
  "Add to Library" press, `trackedExport` + `saveEpub` are called (book lands in the EPUB/Library store),
  `saveBook` is still called (Studio), and the success alert fires only after `saveEpub` resolves. A
  `trackedExport` rejection → the "Couldn't add" path, NO "Added" alert; a 402 → the upgrade prompt.
- No color-literal asserts; `Alert` from `@/lib/alert`.

## Rollout

Web deploy + APK (mobile-only; no backend change — reuses the existing export endpoints). No migration.

## Out of scope

- Changing the Library/Studio store split (Library = compiled EPUBs, Studio = authored books — unchanged).
- The publish-stays-free policy itself (only inherit the existing Studio behavior; flag if it conflicts).
- Backend export changes.
