# F1 Web Book Storage → IndexedDB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Store the (large, image-inlined) `Book` JSON in IndexedDB on web instead of `localStorage`, so importing a real EPUB no longer throws a quota error — without changing F1's data model or render boundary.

**Architecture:** A tiny `bookBlobStore` (web → IndexedDB `sbq_books`/`books`; native → AsyncStorage at the same key) holds the per-book JSON *value*; `bookStore` uses it for `saveBook`/`loadBook`/`deleteBook` with read-migration from the old `localStorage` location. The `BookMeta[]` index stays on AsyncStorage.

**Tech Stack:** IndexedDB (web), `@react-native-async-storage/async-storage` (native + index), `fake-indexeddb` (jest), TypeScript, Jest.

## Global Constraints

- **Branch: `feat/open-shelves`.** Commit here; localhost-only R&D.
- **Do NOT change the data model or render boundary:** images stay inline `data:` URIs in the book; `ImportedChapter.images` unchanged; the sanitizer untouched. Only *where the book JSON is stored* changes.
- **Index unchanged:** `sbq_book_index` (`BookMeta[]`) stays on AsyncStorage both platforms.
- **Migration on read:** a book saved before this fix (in `localStorage`/AsyncStorage at `sbq_book_<id>`) must still open, and be moved to IndexedDB on first load.
- **Native unchanged:** `Platform.OS !== "web"` keeps AsyncStorage behaviour exactly.
- Separate IndexedDB DB (`sbq_books`) — do NOT reuse `epubLibrary`'s `sbq` DB (version-conflict).
- No live network; full mobile suite green + tsc 0 + eslint clean before each commit.

---

## Task 1: `bookBlobStore` — the per-book value store (web IDB / native AsyncStorage)

**Files:**
- Create: `mobile/src/storage/bookBlobStore.ts`
- Modify: `mobile/package.json` (add `fake-indexeddb` devDependency)
- Test: `mobile/__tests__/storage/bookBlobStore.test.ts`

**Interfaces:**
- Produces: `putBookValue(id: string, json: string): Promise<void>`, `getBookValue(id: string): Promise<string | null>`, `delBookValue(id: string): Promise<void>`. Web → IndexedDB; native → AsyncStorage at `sbq_book_${id}`.

- [ ] **Step 1: Add the test dep**
`cd mobile && npm install --save-dev fake-indexeddb` (jest has no IndexedDB). Verify it appears in `package.json` devDependencies.

- [ ] **Step 2: Write the failing test**

`mobile/__tests__/storage/bookBlobStore.test.ts`:
```ts
import "fake-indexeddb/auto";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { putBookValue, getBookValue, delBookValue } from "@/storage/bookBlobStore";

const big = "x".repeat(6 * 1024 * 1024); // 6 MB — over the ~5 MB localStorage ceiling

describe("bookBlobStore", () => {
  afterEach(async () => { await AsyncStorage.clear(); });

  it("web: round-trips a >5 MB value through IndexedDB (no quota error)", async () => {
    Platform.OS = "web";
    await putBookValue("bk-1", big);
    expect(await getBookValue("bk-1")).toBe(big);
    await delBookValue("bk-1");
    expect(await getBookValue("bk-1")).toBeNull();
  });

  it("web: getBookValue returns null for a missing id", async () => {
    Platform.OS = "web";
    expect(await getBookValue("nope")).toBeNull();
  });

  it("native: uses AsyncStorage at sbq_book_<id>", async () => {
    Platform.OS = "ios";
    await putBookValue("bk-2", "hello");
    expect(await AsyncStorage.getItem("sbq_book_bk-2")).toBe("hello");
    expect(await getBookValue("bk-2")).toBe("hello");
    await delBookValue("bk-2");
    expect(await AsyncStorage.getItem("sbq_book_bk-2")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it → fail** (`cd mobile && npx jest __tests__/storage/bookBlobStore.test.ts`) — module doesn't exist.

- [ ] **Step 4: Implement `bookBlobStore.ts`**
```ts
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// The per-book JSON value. On web it can be many MB (F1 inlines images as data:
// URIs), which overflows localStorage — so web uses IndexedDB (blob-capable),
// mirroring @/storage/epubLibrary. Native keeps AsyncStorage at the same key.
const isWeb = Platform.OS === "web";
const nativeKey = (id: string) => `sbq_book_${id}`;

// Web: a dedicated DB (NOT epubLibrary's `sbq` — avoids a version conflict).
const DB_NAME = "sbq_books";
const STORE = "books";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const r = run(db.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export async function putBookValue(id: string, json: string): Promise<void> {
  if (isWeb) { await tx("readwrite", (s) => s.put(json, id)); return; }
  await AsyncStorage.setItem(nativeKey(id), json);
}

export async function getBookValue(id: string): Promise<string | null> {
  if (isWeb) { return (await tx<string | undefined>("readonly", (s) => s.get(id))) ?? null; }
  return AsyncStorage.getItem(nativeKey(id));
}

export async function delBookValue(id: string): Promise<void> {
  if (isWeb) { await tx("readwrite", (s) => s.delete(id)); return; }
  await AsyncStorage.removeItem(nativeKey(id));
}
```

- [ ] **Step 5: Run it → pass** (`npx jest __tests__/storage/bookBlobStore.test.ts`) — 3/3.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/storage/bookBlobStore.ts mobile/__tests__/storage/bookBlobStore.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(storage): bookBlobStore — per-book value in IndexedDB on web (blob-capable)

The book JSON overflows localStorage on web when F1 inlines images as data: URIs.
bookBlobStore stores it in IndexedDB (own DB sbq_books) on web, AsyncStorage on
native — mirroring epubLibrary. Adds fake-indexeddb for the jest round-trip test."
```

---

## Task 2: Wire `bookStore` to `bookBlobStore` + migrate on read

**Files:**
- Modify: `mobile/src/storage/bookStore.ts`
- Test: `mobile/__tests__/storage/bookStore.test.ts` (extend)

**Interfaces:**
- Consumes: `putBookValue`/`getBookValue`/`delBookValue` (Task 1). No signature change to `saveBook`/`loadBook`/`deleteBook` (already async).

- [ ] **Step 1: Write the failing tests**

Extend `mobile/__tests__/storage/bookStore.test.ts`:
```ts
import "fake-indexeddb/auto";
// ... existing imports + saveBook/loadBook/deleteBook, Platform, AsyncStorage

it("web: saves + loads a >5 MB imported book without a quota error", async () => {
  Platform.OS = "web";
  const big = "d".repeat(6 * 1024 * 1024);
  const book = { id: "bk-web", title: "Big", source: "imported",
    toc: { subjects: [] }, updatedAt: new Date(0).toISOString(),
    chapters: { c1: { chapterId: "c1", title: "C1", html: "<p>x</p>",
      images: { "a.png": `data:image/png;base64,${big}` }, importedAt: "" } } } as any;
  await expect(saveBook(book)).resolves.toBeUndefined();
  const loaded = await loadBook("bk-web");
  expect(loaded!.chapters!.c1.images["a.png"]).toContain(big);
});

it("web: migrates a book saved in the old localStorage location on first load", async () => {
  Platform.OS = "web";
  const legacy = { id: "bk-old", title: "Legacy", toc: { subjects: [] }, updatedAt: "" };
  await AsyncStorage.setItem("sbq_book_bk-old", JSON.stringify(legacy)); // old location
  const loaded = await loadBook("bk-old");        // reads + migrates
  expect(loaded!.title).toBe("Legacy");
  expect(await AsyncStorage.getItem("sbq_book_bk-old")).toBeNull(); // moved out of localStorage
  const { getBookValue } = require("@/storage/bookBlobStore");
  expect(await getBookValue("bk-old")).not.toBeNull();              // now in IndexedDB
});
```
(Keep the existing native `bookStore.test.ts` cases — they must still pass unchanged with `Platform.OS="ios"`.)

- [ ] **Step 2: Run → fail** (`npx jest __tests__/storage/bookStore.test.ts`) — old localStorage path throws the quota error / migration path missing.

- [ ] **Step 3: Wire `bookStore.ts`**
- Import: `import { putBookValue, getBookValue, delBookValue } from "@/storage/bookBlobStore";`
- `saveBook`: change the value write from
  `await AsyncStorage.setItem(bookKey(book.id), JSON.stringify(toStore));`
  to `await putBookValue(book.id, JSON.stringify(toStore));` (leave the index write on AsyncStorage).
- `loadBook`: change
  ```ts
  const raw = await AsyncStorage.getItem(bookKey(id));
  ```
  to migrate-on-read:
  ```ts
  let raw = await getBookValue(id);
  if (raw === null) {
    // Migrate a book saved before IndexedDB (old localStorage/AsyncStorage location).
    const legacy = await AsyncStorage.getItem(bookKey(id));
    if (legacy !== null) { await putBookValue(id, legacy); await AsyncStorage.removeItem(bookKey(id)); raw = legacy; }
  }
  if (raw === null) return null;
  ```
  (the rest of `loadBook` — parse, `ensureTopicIds`, default params — unchanged.)
- `deleteBook`: replace `AsyncStorage.removeItem(bookKey(id))` in the `Promise.all` with BOTH
  `delBookValue(id)` and `AsyncStorage.removeItem(bookKey(id))` (clear new + any un-migrated old location); keep the index update + `deleteBookMedia`.

- [ ] **Step 4: Run → pass** (`npx jest __tests__/storage/bookStore.test.ts`) — new web + migration cases pass; existing native cases still pass.

- [ ] **Step 5: Full guard** `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — whole suite green, tsc 0, eslint clean.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/storage/bookStore.ts mobile/__tests__/storage/bookStore.test.ts
git commit -m "fix(storage): bookStore stores book values via bookBlobStore (IndexedDB on web) + migrate

Fixes the localStorage quota error importing a real EPUB on web (F1). The book
JSON now goes to IndexedDB on web via bookBlobStore; books saved in the old
localStorage location migrate on first load. Index stays on AsyncStorage; native
unchanged; F1 data model + render boundary untouched."
```

---

## After all tasks
- **Manual re-check (web):** with the running dev app, re-import the real EPUB that failed — it now saves and opens in the reader (no quota error). Then F2 "Make a quiz" over a real chapter.
- **Whole-branch review** (subagent-driven final review) over the fix range.
- **Follow-ups (tracked):** native AsyncStorage ceiling (a file-per-book store like `epubLibrary` if image-heavy books ever exceed it — N3); consolidating the two book/epub storage systems long-term.

## Self-Review (completed)
- **Spec coverage:** G1 (>5 MB round-trip) → T1 web test + T2 web test; G2 (data model/boundary untouched) → only the value's storage location changes, `ImportedChapter.images` untouched; G3 (migrate) → T2 loadBook fallback + migration test; G4 (native) → `isWeb` branch + native tests unchanged. §4 test approach (fake-indexeddb) → T1 Step 1.
- **Placeholder scan:** none — `bookBlobStore.ts` is complete; the `bookStore` edits are exact before/after; tests are concrete.
- **Consistency:** `putBookValue`/`getBookValue`/`delBookValue`, DB `sbq_books`/store `books`, `sbq_book_<id>` native key, migration fallback — consistent across tasks.
