# Book metadata fields (Description entry + Tags) — design

**Date:** 2026-07-03
**Author:** Siva Mambakkam (with Claude)
**Status:** Approved (design) — pending spec review
**Implements:** ADR-027 D7 (the app-only, buildable slice of it)
**Scope:** `mobile/` only. Adds a `tags` field and the first author-entry UI for
`description` + `tags`. No backend, no compiler, no Open-Library dependency.

---

## Motivation

ADR-027 D7 decided two metadata additions: a free-form **`tags`** field and an
author-supplied **`description`** path. Investigation found:

- `BookMetadata.description` and `subjects: string[]` already exist
  (`mobile/src/types/book.ts:163,168`); **`tags` does not**.
- **There is no author-facing metadata editor.** `BookEditor` edits only title + TOC
  and its save writes `{ title, toc }` only — it **drops `metadata`**
  (`mobile/src/components/BookEditor.tsx`). `BookMetadataModal` is read-only and does
  not even display `description`/`subjects`.
- `description`/`subjects` are only ever set by **verbatim import passthrough**
  (`mobile/src/storage/importBook.ts:54`); nothing lets an author type them.
- **No search exists** in the app; `tags` is captured now for later
  search/discovery (ADR-027 D7).

So this slice adds the `tags` field **and** the first UI for an author to set
`description` + `tags`.

## Non-goals (YAGNI)

- No compiler/EPUB change — `tags` is **app-only** for now (`description` already
  maps to `<dc:description>` in `compiler/src/epub.ts:391`; `tags` EPUB emission is
  deferred with the Open Library). The mobile and compiler `BookMetadata` are
  hand-kept-in-sync; this intentionally diverges (documented in the spec + a code
  comment), to be reconciled when tags reach the artifact.
- No search UI (no consumer yet).
- No file-upload for description — **text field / paste only** (decided).
- No controlled tag vocabulary (ADR-027 O4 — free-form now).
- Not adding `tags` to the `BookMeta` list index (`toMeta`) — nothing consumes it
  yet; add when search lands.

## Design

### Unit 1 — schema: `tags` on `BookMetadata`

`mobile/src/types/book.ts` — add `tags?: string[]` to `BookMetadata` (next to
`subjects`, ~line 168). Optional, free-form. A short doc comment notes it is
app-only today (distinct from `subjects`/`dc:subject`; not yet emitted to EPUB).

### Unit 2 — tag parsing helper

A small pure helper (co-located with `BookEditor`, or `mobile/src/lib/tags.ts`):

```
parseTags(input: string): string[] | undefined
```

- Split on comma, `trim` each, drop empties, de-dupe (case-insensitive, keep first
  spelling). Return `undefined` if nothing remains (so we never store `[]`).
- Inverse `formatTags(tags?: string[]): string` = `(tags ?? []).join(", ")` to seed
  the input from an existing book.

### Unit 3 — author entry in `BookEditor` (also fixes a latent metadata-drop bug)

`mobile/src/components/BookEditor.tsx`. **Current state:** `BookEditor` receives
`{ bookId, initialTitle, initialToc, createdAt, onSaved }` (no `book`/`metadata`).
On save it reconstructs a `Book` object **with no `metadata` field at all** (it only
carries `content`/`generationParams` from the `existing = await loadBook(bookId)` it
already does). So today **editing a book's title/TOC silently drops its `metadata`**
(description, subjects, status, coverSvg, …) for any book that had it (imported /
bundled). This unit fixes that as part of adding the fields.

Changes:

- **New optional props** `initialDescription?: string` and `initialTags?: string[]`,
  passed by callers from the book's `metadata` (see Unit 3b). Add local state
  `description` init `initialDescription ?? ""`, `tagsText` init
  `formatTags(initialTags)`.
- Render a multiline **Description** `TextInput` and a single-line **Tags**
  `TextInput` (placeholder `"comma, separated, tags"`), following the existing
  title-input styling.
- On save, **base metadata on the existing book and merge the edits** — this both
  preserves all prior metadata (fixing the drop) and applies the new values:
  ```
  metadata: {
    ...(existing?.metadata ?? {}),
    description: description.trim() || undefined,
    tags: parseTags(tagsText),
  }
  ```
  For a new book (`bookId === null`, `existing === null`) this is
  `{ description, tags }`. Add `metadata` to the reconstructed `Book` object.
- Title + TOC save behaviour otherwise unchanged.

### Unit 3b — callers pass the initial metadata

Find every render of `<BookEditor …>` and pass `initialDescription` /
`initialTags` from the book's `metadata` (the editor caller already has the book, or
can `loadBook` it as it does for title/TOC). New-book flow passes neither (empty).
This keeps `BookEditor`'s "initial values come from props" pattern intact.

### Unit 4 — display in `BookMetadataModal`

`mobile/src/components/BookMetadataModal.tsx` — add read-only rows for **Description**
and **Tags** (tags joined with `, `) shown **only when present**, using the existing
`Row`/`<Text selectable>` pattern.

### Unit 5 — import guard for `tags`

`mobile/src/storage/importBook.ts` — the metadata object is currently cast
unchecked (`as Book["metadata"]`, line 54). Add a light coercion so an imported
`tags` is normalised to `string[]` (keep only string entries; drop the field if not
an array). Other metadata fields keep flowing through verbatim.

## Data flow

Author types Description + Tags in `BookEditor` → save merges into `book.metadata`
→ `saveBook` persists (`bookStore.ts`) → `BookMetadataModal` renders them read-only.
Imported books carry `tags` through the (now-guarded) passthrough.

## Error / edge handling

- `parseTags`: empty / whitespace-only / all-duplicate input → `undefined` (never
  `[]`). Duplicates de-duped case-insensitively.
- Empty description → stored as `undefined`, not `""`.
- Import: `tags` present but not an array, or array with non-strings → coerced
  (non-strings dropped) or omitted; never throws (matches importBook's lenient
  metadata handling).
- Merging metadata must not clobber unrelated fields (`status`, `version`,
  `subjects`, `coverSvg`, …).

## Testing

Mirror existing patterns (in-memory AsyncStorage mock with `__reset`;
`validBookJson(overrides)` factory).

- **tags helper** (`lib/tags.test.ts`): parse comma list; trims; drops empties;
  de-dupes case-insensitively; empty → `undefined`; `formatTags` round-trips.
- **bookStore** (`storage/bookStore.test.ts`): a book saved with
  `metadata.tags` + `metadata.description` round-trips via `loadBook`.
- **importBook** (`storage/importBook.test.ts`): JSON with `metadata.tags` array
  imports intact; `tags` as a non-array is dropped; non-string entries filtered;
  unrelated metadata preserved.
- **BookEditor** (`components/BookEditor.test.tsx`): editing description + tags and
  saving calls `onSave` with merged `metadata` that **preserves a pre-existing
  metadata field** (e.g. `status`) and sets `description`/`tags`.
- **BookMetadataModal** (`components/BookMetadataModal.test.tsx`): renders
  Description + Tags when present; renders neither when absent.

## Risk

Low. App-only, additive, optional field. Main watch-item: the `BookEditor` save
must **merge** `metadata` (today it omits it) without regressing title/TOC save —
covered by the BookEditor test.
