# Book Metadata Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author set a book **Description** and free-form **Tags**, add `tags` to the book schema, and display both — app-only (ADR-027 D7 slice).

**Architecture:** Additive change in `mobile/`. New `tags` field on `BookMetadata`; a pure `tags` parse/format helper; Description + Tags inputs added to the existing `BookEditor` (whose save is fixed to merge metadata rather than drop it); read-only display in `BookMetadataModal`; a coercion guard on import. No backend, compiler, or search changes.

**Tech Stack:** React Native + Expo, TypeScript, Jest + React Native Testing Library. Run `npm test` / `npx tsc --noEmit` from `mobile/`.

## Global Constraints

- Scope: **`mobile/` only.** No `compiler/`, `backend/`, or search changes. `tags` is app-only (not emitted to EPUB yet).
- `tags` is **free-form** `string[]`, optional; never stored as `[]` (use `undefined` when empty).
- Description input is **text/paste only** (no file upload).
- `BookEditor` save must **merge** `metadata` (preserve prior fields), fixing the current drop — must not regress title/TOC/content save.
- All commands run from `mobile/`. Commit-message co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `tags` schema field + tag parse/format helper

**Files:**
- Modify: `mobile/src/types/book.ts` (`BookMetadata`, ~line 168, after `subjects?: string[];`)
- Create: `mobile/src/lib/tags.ts`
- Test: `mobile/__tests__/lib/tags.test.ts`

**Interfaces:**
- Produces: `parseTags(input: string): string[] | undefined`, `formatTags(tags?: string[]): string`, and `BookMetadata.tags?: string[]`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/lib/tags.test.ts`:

```ts
import { parseTags, formatTags } from "@/lib/tags";

describe("parseTags", () => {
  it("splits a comma list and trims each tag", () => {
    expect(parseTags("math, physics ,  chemistry")).toEqual(["math", "physics", "chemistry"]);
  });
  it("drops empties; all-empty/blank → undefined", () => {
    expect(parseTags("  ,  , ")).toBeUndefined();
    expect(parseTags("")).toBeUndefined();
  });
  it("de-dupes case-insensitively, keeping the first spelling", () => {
    expect(parseTags("Math, math, MATH, algebra")).toEqual(["Math", "algebra"]);
  });
});

describe("formatTags", () => {
  it("joins with comma-space; undefined → empty string", () => {
    expect(formatTags(["a", "b"])).toBe("a, b");
    expect(formatTags(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/lib/tags.test.ts`
Expected: FAIL — cannot find module `@/lib/tags`.

- [ ] **Step 3: Implement the helper and add the schema field**

Create `mobile/src/lib/tags.ts`:

```ts
// Free-form book tags (ADR-027 D7). App-only today — NOT emitted to EPUB and
// distinct from BookMetadata.subjects / dc:subject. Used for in-app organisation
// now and search/discovery when the library grows.

/** Parse a comma-separated tag string into a clean list, or undefined if empty.
 * Trims, drops blanks, de-dupes case-insensitively (keeps the first spelling). */
export function parseTags(input: string): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/** Inverse of parseTags for seeding a text input from stored tags. */
export function formatTags(tags?: string[]): string {
  return (tags ?? []).join(", ");
}
```

In `mobile/src/types/book.ts`, add the `tags` field to `BookMetadata` immediately after the `subjects?: string[];` line:

```ts
  subjects?: string[];
  // Free-form author tags for in-app organisation + future search (ADR-027 D7).
  // App-only: distinct from `subjects`/dc:subject and NOT yet emitted to EPUB
  // (compiler/src/types.ts intentionally not synced for this field yet).
  tags?: string[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/lib/tags.test.ts && npx tsc --noEmit`
Expected: PASS; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/tags.ts mobile/__tests__/lib/tags.test.ts mobile/src/types/book.ts
git commit -m "feat(books): add free-form tags field + parse/format helper"
```

---

### Task 2: coerce `tags` on import (`parseBook`)

**Files:**
- Modify: `mobile/src/storage/importBook.ts` (~line 54, the `metadata` cast)
- Test: `mobile/__tests__/storage/importBook.test.ts` (append)

**Interfaces:**
- Consumes: `parseBook(raw: string): Book` (existing export), `BookMetadata.tags` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `mobile/__tests__/storage/importBook.test.ts` (the file already imports `parseBook` and has `validBookJson`). Build the raw JSON by injecting `metadata` into a valid book, so it doesn't depend on `validBookJson`'s override handling:

```ts
describe("parseBook — tags coercion (ADR-027 D7)", () => {
  const withMetadata = (metadata: unknown): string => {
    const obj = JSON.parse(validBookJson());
    obj.metadata = metadata;
    return JSON.stringify(obj);
  };

  it("keeps a valid string[] tags array", () => {
    const b = parseBook(withMetadata({ tags: ["ai", "product"] }));
    expect(b.metadata?.tags).toEqual(["ai", "product"]);
  });
  it("filters non-string tag entries", () => {
    const b = parseBook(withMetadata({ tags: ["ai", 2, null, "x"] }));
    expect(b.metadata?.tags).toEqual(["ai", "x"]);
  });
  it("drops a non-array tags value", () => {
    const b = parseBook(withMetadata({ tags: "not-an-array" }));
    expect(b.metadata?.tags).toBeUndefined();
  });
  it("preserves other metadata fields untouched", () => {
    const b = parseBook(withMetadata({ description: "d", status: "release", tags: ["t"] }));
    expect(b.metadata?.description).toBe("d");
    expect(b.metadata?.status).toBe("release");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/storage/importBook.test.ts -t "tags coercion"`
Expected: FAIL — `filters non-string tag entries` (unfiltered) and `drops a non-array tags value` (string kept) fail.

- [ ] **Step 3: Implement the coercion**

In `mobile/src/storage/importBook.ts`, replace the single `metadata` line (currently):

```ts
  const metadata = isRecord(data.metadata) ? (data.metadata as Book["metadata"]) : undefined;
```

with:

```ts
  const metadata = isRecord(data.metadata) ? (data.metadata as Book["metadata"]) : undefined;
  if (metadata && "tags" in metadata) {
    // Normalise imported tags to a clean string[] (or drop the field). Other
    // metadata still flows through verbatim (the compiler is the authority).
    metadata.tags = Array.isArray(metadata.tags)
      ? metadata.tags.filter((t): t is string => typeof t === "string")
      : undefined;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/storage/importBook.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/storage/importBook.ts mobile/__tests__/storage/importBook.test.ts
git commit -m "feat(books): normalise imported tags to string[]"
```

---

### Task 3: Description + Tags inputs in `BookEditor` (merges metadata; fixes drop)

**Files:**
- Modify: `mobile/src/components/BookEditor.tsx`
- Modify: `mobile/app/book/saved/[id].tsx` (~line 77 — the `<BookEditor>` for an existing book)
- Modify: `mobile/app/book/new.tsx` (~line 150 — new-book `<BookEditor>`; no change needed to props, confirm)
- Test: `mobile/__tests__/components/BookEditor.test.tsx` (append)

**Interfaces:**
- Consumes: `parseTags`, `formatTags` (Task 1); `loadBook`, `saveBook` (existing `@/storage/bookStore`).
- Produces: `BookEditor` now accepts `initialDescription?: string` and `initialTags?: string[]`; on save the persisted `Book` carries `metadata: { ...(existing?.metadata ?? {}), description, tags }`.

- [ ] **Step 1: Write the failing test**

Append to `mobile/__tests__/components/BookEditor.test.tsx`. It should mock `@/storage/bookStore` so `loadBook` returns an existing book **with a metadata field to preserve**, render the editor, edit Description + Tags, save, and assert `onSaved` received merged metadata. Match the existing file's mocking style; if it doesn't already mock bookStore/settingsStore, add:

```ts
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { BookEditor } from "@/components/BookEditor";

const saveBook = jest.fn().mockResolvedValue(undefined);
const loadBook = jest.fn();
jest.mock("@/storage/bookStore", () => ({
  saveBook: (...a: unknown[]) => saveBook(...a),
  loadBook: (...a: unknown[]) => loadBook(...a),
}));
jest.mock("@/storage/settingsStore", () => ({
  loadDefaultParams: jest.fn().mockResolvedValue({ provider: "anthropic" }),
}));

const baseToc = { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "U", subtopics: [], prerequisites: [] }] }] };

describe("BookEditor — description + tags (ADR-027 D7)", () => {
  beforeEach(() => {
    saveBook.mockClear();
    loadBook.mockReset();
  });

  it("saves merged metadata and preserves existing metadata fields", async () => {
    loadBook.mockResolvedValue({
      id: "b1", title: "T", toc: baseToc, createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      metadata: { status: "release", description: "old" },
      generationParams: { provider: "anthropic" },
    });
    const onSaved = jest.fn();
    const { getByLabelText } = render(
      <BookEditor bookId="b1" initialTitle="T" initialToc={baseToc as never}
        initialDescription="old" initialTags={["keep"]} onSaved={onSaved} />,
    );
    fireEvent.changeText(getByLabelText("Book description"), "A fresh blurb");
    fireEvent.changeText(getByLabelText("Book tags"), "ai, product, ai");
    fireEvent.press(getByLabelText("Save book"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = onSaved.mock.calls[0][0];
    expect(saved.metadata).toEqual(expect.objectContaining({
      status: "release",                 // preserved (the drop-bug fix)
      description: "A fresh blurb",
      tags: ["ai", "product"],           // de-duped
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/BookEditor.test.tsx -t "description + tags"`
Expected: FAIL — no `Book description` label (input doesn't exist); `saved.metadata` undefined.

- [ ] **Step 3: Implement the inputs + metadata merge**

In `mobile/src/components/BookEditor.tsx`:

(a) Add the import:

```ts
import { parseTags, formatTags } from "@/lib/tags";
```

(b) Extend `Props` (after `initialToc: StructuredTOC;`):

```ts
  initialDescription?: string;
  initialTags?: string[];
```

(c) Destructure them in the component signature and add state (after the `toc` state):

```ts
  const [description, setDescription] = useState(initialDescription ?? "");
  const [tagsText, setTagsText] = useState(formatTags(initialTags));
```

(d) In `handleSave`, add `metadata` to the reconstructed `book` object (the function already computes `existing`). The object becomes:

```ts
      const book: Book = {
        id: bookId ?? newId(),
        title: title.trim(),
        toc,
        createdAt: createdAt ?? now,
        updatedAt: now,
        content: existing?.content,
        generationParams,
        metadata: {
          ...(existing?.metadata ?? {}),
          description: description.trim() || undefined,
          tags: parseTags(tagsText),
        },
      };
```

(e) Add the inputs in the returned JSX, between the title block and the `Topics` label:

```tsx
      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.descInput}
        value={description}
        onChangeText={setDescription}
        placeholder="A short blurb about this book"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Book description"
        multiline
      />

      <Text style={styles.label}>Tags</Text>
      <TextInput
        style={styles.titleInput}
        value={tagsText}
        onChangeText={setTagsText}
        placeholder="comma, separated, tags"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Book tags"
        autoCapitalize="none"
      />
```

(f) Add a `descInput` style to the `StyleSheet.create({...})` (mirror `titleInput` but taller, regular weight):

```ts
  descInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
    minHeight: 72,
    textAlignVertical: "top",
  },
```

- [ ] **Step 4: Wire the existing-book caller**

In `mobile/app/book/saved/[id].tsx`, the `<BookEditor>` (~line 77) already has `book` in scope. Add the two props:

```tsx
        <BookEditor
          bookId={book.id}
          initialTitle={book.title}
          initialToc={book.toc}
          createdAt={book.createdAt}
          initialDescription={book.metadata?.description}
          initialTags={book.metadata?.tags}
          onSaved={() => router.replace("/books")}
        />
```

`mobile/app/book/new.tsx` (~line 150) is the new-book flow with no existing metadata — the new props are optional, so **leave it unchanged** (they default to empty). Confirm it still typechecks.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd mobile && npx jest __tests__/components/BookEditor.test.tsx && npx tsc --noEmit`
Expected: PASS; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/BookEditor.tsx "mobile/app/book/saved/[id].tsx" mobile/__tests__/components/BookEditor.test.tsx
git commit -m "feat(books): edit Description + Tags in BookEditor (merges/preserves metadata)"
```

---

### Task 4: display Description + Tags in `BookMetadataModal`

**Files:**
- Modify: `mobile/src/components/BookMetadataModal.tsx` (`BookMetadataRows`, `deriveRows`, the row list JSX)
- Test: `mobile/__tests__/components/BookMetadataModal.test.tsx` (append — the file already tests `deriveRows`)

**Interfaces:**
- Consumes: `deriveRows(book, fallback): BookMetadataRows` (existing export), `BookMetadata.description`/`tags`.

- [ ] **Step 1: Write the failing test**

Append to `mobile/__tests__/components/BookMetadataModal.test.tsx`:

```ts
import { deriveRows } from "@/components/BookMetadataModal";

const bookWith = (metadata: Record<string, unknown>) =>
  ({ id: "b", title: "T", toc: { subjects: [] }, createdAt: "", updatedAt: "", metadata } as never);

describe("deriveRows — description + tags", () => {
  it("surfaces description and joined tags when present", () => {
    const rows = deriveRows(bookWith({ description: "A blurb", tags: ["ai", "product"] }), { title: "T" });
    expect(rows.description).toBe("A blurb");
    expect(rows.tags).toBe("ai, product");
  });
  it("leaves them undefined when absent or empty", () => {
    const rows = deriveRows(bookWith({ tags: [] }), { title: "T" });
    expect(rows.description).toBeUndefined();
    expect(rows.tags).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/BookMetadataModal.test.tsx -t "description + tags"`
Expected: FAIL — `rows.description` / `rows.tags` are `undefined` (not in the type / not derived).

- [ ] **Step 3: Implement derivation + display**

In `mobile/src/components/BookMetadataModal.tsx`:

(a) Add two optional fields to `BookMetadataRows` (after `reviewedOn: string;`):

```ts
  description?: string;
  tags?: string;
```

(b) In `deriveRows`, add them to the returned object (after `reviewedOn: ...`):

```ts
    description: meta?.description || undefined,
    tags: meta?.tags && meta.tags.length > 0 ? meta.tags.join(", ") : undefined,
```

(c) In the rows JSX (inside the `<ScrollView>` row list, after `<Row label="Reviewed On" .../>`), render them only when present:

```tsx
            {rows.description ? <Row label="Description" value={rows.description} /> : null}
            {rows.tags ? <Row label="Tags" value={rows.tags} /> : null}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd mobile && npx jest __tests__/components/BookMetadataModal.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/BookMetadataModal.tsx mobile/__tests__/components/BookMetadataModal.test.tsx
git commit -m "feat(books): show Description + Tags in the metadata window"
```

---

## Final verification (after all tasks)

- [ ] **Full mobile suite:** `cd mobile && npm test` → green.
- [ ] **Typecheck:** `cd mobile && npx tsc --noEmit` → no new errors.
- [ ] Open a PR against `main`.

## Notes

- `compiler/src/types.ts` `BookMetadata` is intentionally **not** updated (tags stay app-only per the spec's non-goals). A code comment in `book.ts` records the deliberate divergence.
- No change to `bookStore.ts` `toMeta` / `BookMeta` (tags aren't surfaced in the list index — no consumer yet).
