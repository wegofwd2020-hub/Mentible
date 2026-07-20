# F1 web book storage — IndexedDB (fix the localStorage quota) — design

**Date:** 2026-07-19
**Status:** Approved (brainstorm), pending plan
**Branch:** `feat/open-shelves` (where F1/F2 live; localhost-only R&D)
**Surfaced by:** live web review of F1 — importing a real EPUB throws
`Failed to execute 'setItem' on 'Storage': … exceeded the quota` (`sbq_book_<id>`).

## 1. Problem

`bookStore.saveBook` persists the whole `Book` as one value:
`AsyncStorage.setItem("sbq_book_<id>", JSON.stringify(book))`. On **web**, AsyncStorage is backed by
`localStorage` (~5 MB per origin). F1 imported books inline **every image as a base64 `data:` URI inside
the chapter** (`ImportedChapter.images: Record<zipPath, dataURI>`), so an image-heavy EPUB produces a
multi-MB JSON value → `setItem` exceeds the quota → import fails. `bookStore.ts:9` already flagged this
("outgrow AsyncStorage's quota — ADR-003 open question"). The old `epubLibrary` avoided it by using
**IndexedDB on web** (blob-capable) — the proven pattern to reuse.

## 2. Goals / non-goals

**Goals**
- G1. A large imported `Book` (>5 MB, image-heavy) saves + loads on **web** without a quota error.
- G2. **Do not change F1's data model or render boundary.** Images stay inline `data:` URIs in the book;
  the sanitizer's "images resolve to `data:` only / no network" guarantee is untouched. Only *where the
  book JSON is stored* changes.
- G3. Books saved before this fix (in `localStorage`) still open — **migrate on read**.
- G4. Native behaviour unchanged (still AsyncStorage).

**Non-goals**
- N1. Not externalizing images to a blob store / changing `ImportedChapter.images` (that would touch the
  security-reviewed render boundary — rejected in brainstorm as Approach B).
- N2. Not migrating the **index** (`sbq_book_index`, `BookMeta[]`) — it is small and stays on AsyncStorage
  both platforms.
- N3. Not addressing a native AsyncStorage ceiling (the reported bug is web; a native file-per-book store,
  like `epubLibrary`'s, is a separate later follow-up if image-heavy books ever exceed native limits).
- N4. Not touching `mediaStore` (author-attached topic images, a separate store).

## 3. Design

### 3.1 A book-value store (`bookBlobStore`)
New module `mobile/src/storage/bookBlobStore.ts` — a tiny key→value store for the **book JSON string**,
branching on `Platform.OS === "web"` (mirroring `epubLibrary`'s runtime branch):
- **Web → IndexedDB.** Its **own** database `sbq_books`, object store `books` (keyPath-less; key = book
  id, value = the JSON string), version 1. A separate DB avoids a version conflict with `epubLibrary`'s
  `sbq`/`epubs` DB. Helpers: `openDb()`, `get(id)`, `set(id, json)`, `del(id)` (mirror `epubLibrary`'s
  `openDb`/`tx` shape).
- **Native → AsyncStorage** at the same `sbq_book_<id>` key as today (no behaviour change).

API: `putBookValue(id: string, json: string): Promise<void>`, `getBookValue(id: string): Promise<string |
null>`, `delBookValue(id: string): Promise<void>`.

### 3.2 Wire `bookStore` to it (value only; index unchanged)
- `saveBook`: replace `AsyncStorage.setItem(bookKey(book.id), JSON.stringify(toStore))` with
  `putBookValue(book.id, JSON.stringify(toStore))`. The index write stays on AsyncStorage.
- `loadBook`: replace `AsyncStorage.getItem(bookKey(id))` with `getBookValue(id)` — **with migration**:
  if `getBookValue` returns null, fall back to `AsyncStorage.getItem("sbq_book_"+id)` (old location); if
  found, `putBookValue(id, raw)` + `AsyncStorage.removeItem("sbq_book_"+id)` (migrate), then parse. So a
  pre-fix book opens once and is moved to IndexedDB.
- `deleteBook`: `delBookValue(id)` **and** `AsyncStorage.removeItem(bookKey(id))` (clear both the new and
  any un-migrated old location), plus the existing index update + `deleteBookMedia`.

### 3.3 Web vs native selection
Use `Platform.OS === "web"` inside `bookBlobStore` (runtime branch, like `epubLibrary`) rather than a
`.web.ts` file split — matches the existing storage convention and keeps one module.

## 4. Testing

- Add **`fake-indexeddb`** (dev dependency) — jest has no IndexedDB; `epubLibrary`'s IDB path was never
  tested, so this also establishes the pattern. Tests `import "fake-indexeddb/auto"` to polyfill the
  global, and force the web branch (`Platform.OS = "web"`).
- **G1 (the bug):** a `Book` whose serialized JSON is **>5 MB** (e.g. a chapter with a large `data:` image
  string) round-trips through `saveBook`→`loadBook` on web with no throw and byte-identical content. This
  is the test that would have caught the reported failure.
- **G3 (migration):** seed `AsyncStorage["sbq_book_<id>"]` with a book JSON (old location), then
  `loadBook` returns it AND moves it to IndexedDB (subsequent `getBookValue` hits IndexedDB;
  AsyncStorage old key is cleared).
- **G4 (native):** with `Platform.OS = "ios"`, `saveBook`/`loadBook`/`deleteBook` use AsyncStorage exactly
  as before (the existing `bookStore.test.ts` behaviours still pass unchanged).
- `deleteBook` removes the value from both locations.
- Full mobile suite green, tsc 0, eslint clean.

## 5. Risks

- **R1. Async surface change.** `bookBlobStore` is async (IndexedDB is); `bookStore` is already async, so
  no signature change to `saveBook`/`loadBook`/`deleteBook`. Verify no caller assumed sync.
- **R2. IndexedDB unavailable** (private-mode / ancient browser). `openDb` rejects → `saveBook` throws a
  clear error (better than a silent quota failure). Acceptable; note it.
- **R3. Native ceiling not addressed** (N3) — flagged, out of scope.
- **R4. The render boundary is untouched** (G2) — no security re-review needed, which is the whole reason
  Approach A was chosen over B.
