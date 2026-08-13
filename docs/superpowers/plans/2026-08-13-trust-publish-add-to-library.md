# Trust Publish "Add to Library" lands in Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trust workspace Publish "Add to Library" actually adds the book to the Library (compiled EPUB), not just the Studio store.

**Architecture:** Both trust Publish handlers currently `saveBook(book)` only (→ bookStore = Studio; Library lists compiled EPUBs via `listEpubs`). Mirror Studio's `SaveToLibraryButton`: after assembling the book, ALSO `trackedExport`→cover→`saveEpub` so it lands in Library, keeping `saveBook` so it also stays in Studio.

**Tech Stack:** React Native (Expo); Jest + RNTL. Mobile-only.

## Global Constraints

- Keep `saveBook(book)` (Studio copy — user wants it) AND add the EPUB compile→`saveEpub` (Library).
- Compiling is minutes-long → show a "Compiling EPUB…" busy label while `pubBusy` is set (mirror `SaveToLibraryButton`). Only alert "Added" AFTER `saveEpub` resolves.
- A 402 from the export (Free user) → the existing upgrade prompt (`onDownloadError` handles 402); other errors → the existing "Couldn't add" alert. Never claim "Added" on a compile failure.
- No color-literal asserts; `Alert` from `@/lib/alert`. Mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** reference impl `src/components/SaveToLibraryButton.tsx` (`trackedExport(book, "epub", {diagrams:true})` → `{artifact: bytes}`; cover via `exportBook(book, {format:"cover"})` best-effort; `saveEpub({bookId, title, bytes, coverBytes})` from `@/storage/epubLibrary`). Both handlers in `mobile/app/trust/[projectId].tsx`: `onPublishToLibrary` (uses `assembleBook()`) and `onAddToLibrary(versionId, title, _format)` (uses `loadVersionContent` → `artifactToBook`). `exportBook`, `ApiError` from `@/api/client`; `trackedExport` from `@/lib/trackedExport`. `pubBusy` state + `setPubBusy` already exist; `onDownloadError` already routes 402 → upgrade prompt.

---

### Task 1: Both trust Publish "Add to Library" handlers compile + saveEpub

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (`onPublishToLibrary`, `onAddToLibrary`; imports)
- Test: the trust project detail Publish test (extend the existing `TrustProjectDetail.*` publish test, or add `TrustProjectDetail.addtolibrary.test.tsx`)

**Interfaces:**
- Consumes: `trackedExport`, `exportBook`, `saveEpub`, `saveBook` (already imported or add), `onDownloadError`.

- [ ] **Step 1: Add imports** if missing to `[projectId].tsx`: `import { saveEpub } from "@/storage/epubLibrary";` and ensure `exportBook`, `ApiError` (from `@/api/client`) and `trackedExport` (from `@/lib/trackedExport`) are imported (some already are — check).

- [ ] **Step 2: Write the failing test.** In the trust publish test (mock `@/lib/trackedExport` `trackedExport` → `{artifact: new ArrayBuffer(8)}`, `@/api/client` `exportBook` → `{artifact: new ArrayBuffer(4)}`, `@/storage/epubLibrary` `saveEpub`, `@/storage/bookStore` `saveBook`, and `assembleBook`'s deps / `loadVersionContent`+`artifactToBook`). Render the Publish phase as owner + book-validated, press **"Add to Library"** (the `onPublishToLibrary` button) and assert:
  - `trackedExport` is called with `(book, "epub", { diagrams: true })`, then `saveEpub` is called with `{ bookId, title, bytes, coverBytes }` (book reached the Library/EPUB store);
  - `saveBook` is ALSO called (Studio copy retained);
  - the "Added" alert fires only after `saveEpub` resolves.
  - A `trackedExport` rejection with `new ApiError(402, ...)` → the upgrade prompt (via `onDownloadError`), and `saveEpub` NOT called, NO "Added" alert. A generic rejection → "Couldn't add", no "Added".
  Repeat the accept-path assertion for the per-artifact `onAddToLibrary` (whole-book Publish mode) — one representative assertion is enough since the two share the shape, but exercise both press paths. No color-literal asserts.

- [ ] **Step 3: Run — FAIL** (`saveEpub` never called today). `cd mobile && npx jest -t "Library"` (or the test file).

- [ ] **Step 4: Implement.** In `onPublishToLibrary`:
```ts
const onPublishToLibrary = () => {
  setPubBusy("book:lib");
  void (async () => {
    try {
      const book = await assembleBook();
      await saveBook(book);                                   // Studio copy (kept)
      const { artifact: bytes } = await trackedExport(book, "epub", { diagrams: true });
      let coverBytes: ArrayBuffer | undefined;
      try { coverBytes = (await exportBook(book, { format: "cover" })).artifact; } catch { coverBytes = undefined; }
      await saveEpub({ bookId: book.id, title: book.title, bytes, coverBytes });
      Alert.alert("Added", "Added to your Library.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) { onDownloadError(e); return; }
      Alert.alert("Couldn't add", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setPubBusy(null);
    }
  })();
};
```
Apply the same shape to `onAddToLibrary` (assemble via `artifactToBook`, then `saveBook` + `trackedExport` + cover + `saveEpub`, same error handling; keep its `pubBusy` key `${versionId}:lib`).

- [ ] **Step 5: Busy label.** Where the "Add to Library" button renders its busy state (PublishPanel, `busy={pubBusy === "book:lib"}` / `${versionId}:lib`), ensure the busy affordance reads as a compile in progress — if the `Button` shows only a spinner, that's acceptable; if it shows a label, make the busy label "Compiling EPUB…". (Match how the Download buttons already show their busy state; don't over-engineer.)

- [ ] **Step 6: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. All green.

- [ ] **Step 7: Commit**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__
git commit -m "fix(trust): Publish 'Add to Library' compiles + saveEpub so the book lands in Library

Add-to-Library only did saveBook (Studio store); the Library tab lists compiled EPUBs
(listEpubs), so the book never appeared there. Mirror SaveToLibraryButton: trackedExport
+ cover + saveEpub (Library), keeping saveBook (Studio). 402 → upgrade prompt.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] Both Publish "Add to Library" paths call `trackedExport`+`saveEpub` (Library) AND `saveBook` (Studio); success alert only after `saveEpub`; 402 → upgrade prompt.
- [ ] **Deploy:** web deploy + APK. No backend change, no migration.

## Out of scope

- The Library/Studio store split. The publish-stays-free policy (public-catalog `/library/{id}/publish` is separate). Backend changes.
