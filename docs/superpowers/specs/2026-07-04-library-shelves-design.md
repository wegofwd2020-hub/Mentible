# Library Shelves — Design Spec

**Date:** 2026-07-04
**Status:** Approved (brainstorm)
**Feature:** Group books into named shelves on the Library page.

## Summary

Add named **shelves** to the Library so the user can organize their books. A book
belongs to **at most one shelf** at a time. The Library becomes a single vertically
scrolling page of **shelf bands**: each band is a warm-wood shelf with the shelf name
above it and the shelf's books sitting on it as **spines** (title down the binding).
Tapping a spine **pulls the book out** to reveal its cover and actions. Books in no
shelf fall into an **Unshelved** band at the bottom.

This is a purely **organizational overlay** on the existing flat Library — device-local,
no book data moves, no new backend, no sync.

## Scope

**In scope**
- Non-demo `EpubLibrary` (authored books + imported EPUBs — any book in the `items` list).
- Create / rename / delete shelves; move a book to a shelf / remove from shelf.
- Spine rendering with tap-to-pull-out; warm-wood shelf visual (direction "A").

**Out of scope**
- The **Demo Library** (`DemoLibrary` in `library.tsx`) — unchanged, no shelves.
- **Sync** — device-local only, consistent with the deferred sync build (library is
  local-first at MVP; see CLAUDE.md D4).
- **Drag-and-drop** assignment or **drag-reorder** of shelves.
- Nested shelves / a book in multiple shelves.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | **Navigation model:** sections on one vertically scrolling page (no drill-in route). |
| 2 | **Book render:** spine + cover **hybrid** — spines by default, tap pulls the book out to reveal cover + actions. |
| 3 | **Shelf visual:** warm-wood plank, saturated multicolor spines (direction "A"). |
| 4 | **Assignment:** via a **Move-to-shelf picker** opened from the pulled-out book's ⋯ menu (no drag-and-drop). |
| 5 | **Shelf management:** **inline on the Library** — a `＋ New shelf` button; tap a shelf name to Rename / Delete. Also creatable from the picker's "New shelf…". No separate screen. |
| 6 | **Delete shelf:** the shelf (a label) is removed and its books become **Unshelved**. Books are **never** deleted by a shelf action. |
| 7 | **Empty shelves:** rendered with an empty plank + hint ("No books yet — move some here"). |
| 8 | **Shelf order:** creation order (newest appended, above Unshelved). No manual reorder at MVP. |
| 9 | **Rack overflow:** each shelf rack scrolls **horizontally** when it holds many books (rather than wrapping to multiple rows). |

## Data model

New module `mobile/src/storage/shelfStore.ts`. Two small JSON values in AsyncStorage
(metadata only, no blobs — AsyncStorage is used cross-platform already):

- `sbq_shelves` → `Shelf[]`
- `sbq_shelf_assignments` → `Record<bookId, shelfId>`

```ts
export interface Shelf {
  id: string;        // randomUUID() from @/lib/uuid (Hermes has no global crypto)
  name: string;      // user-entered, trimmed, non-empty
  createdAt: string; // ISO
  order: number;     // ascending; new shelves get max(order)+1
}
```

`bookId` is the `EpubMeta.id` (== source book id). Storing the assignment as a
`bookId → shelfId` map makes the "one shelf at a time" invariant structural: a book
key has exactly one value. Removing a book from its shelf deletes its key.

### Public API

```ts
listShelves(): Promise<Shelf[]>                       // sorted by order asc
createShelf(name: string): Promise<Shelf>             // appended (order = max+1)
renameShelf(id: string, name: string): Promise<void>
deleteShelf(id: string): Promise<void>                // removes shelf + prunes its assignments
getAssignments(): Promise<Record<string, string>>
assignBook(bookId: string, shelfId: string | null): Promise<void>  // null = unshelve
pruneBook(bookId: string): Promise<void>              // called when a book is deleted
```

- `createShelf` / `renameShelf` trim the name and reject empty.
- `deleteShelf` iterates the assignment map and deletes every entry whose value ==
  the deleted shelf id (books drop to Unshelved). It never touches `epubLibrary`.
- Follows `epubLibrary.ts` conventions: JSON in AsyncStorage, defensive parse
  (return `[]` / `{}` on malformed data).

Uses `randomUUID()` from `@/lib/uuid` (never `crypto.randomUUID()` directly — see the
Hermes-no-crypto note).

## Grouping (in `library.tsx` / a small helper)

A pure function turns the three inputs into ordered render sections:

```ts
type ShelfSection = { shelf: Shelf | null; books: EpubMeta[] };
function groupIntoShelves(
  items: EpubMeta[],
  shelves: Shelf[],
  assignments: Record<string, string>,
): ShelfSection[]
```

- One section per shelf (in `order`), **including empty shelves**.
- A final `{ shelf: null, books: [...] }` **Unshelved** section: books whose id has no
  assignment, **or** whose assignment points at a shelf id that no longer exists
  (defensive — a stale pointer reads as unshelved).
- Within each section, preserve the existing `compiledAt desc` sort.
- The Unshelved section is included only when it has ≥1 book (no empty Unshelved band).

This helper is unit-testable in isolation with no storage/UI.

## Components (in `mobile/src/components/`)

### `Shelf`
One shelf band: name header (with a ✎ affordance) + warm-wood plank + a
horizontally-scrolling rack of `BookSpine`s. Empty → empty plank + hint text.
Tapping the name opens a Rename / Delete menu. Props: `{ shelf, books, ...handlers }`.
`shelf === null` renders the Unshelved band (name "Unshelved", no ✎, no delete).

### `BookSpine`
A single spine: fixed narrow width, title running down the binding
(`writing-mode: vertical` / rotated text), a **deterministic** warm color and a
slightly varied height, both hashed from the book id (stable across renders). Tap →
notifies the parent to enter the **pulled-out** state for this book.

### Pulled-out state
When a spine is tapped, that book floats out above the rack showing:
- its cover (**reuse `BookCover`** with the book's `coverUri` / `coverSvg`),
- an export-status badge on/near the cover (reuse `ExportStatusPills` data),
- an action row: **Read** · **💬 reviews (count)** · **⋯**.

Actions reuse existing handlers from `library.tsx`:
- **Read** → `openItem(item)` (reader for authored; share sheet for `imported-*`).
- **💬** → `openReviews(item)`.
- **⋯** menu → *Move to shelf…* (opens the picker) · *Book details* (existing
  `BookMetadataModal`) · *Delete* (existing `handleDelete`, which now also calls
  `pruneBook`).

Only one book is pulled out at a time; tapping elsewhere / another spine collapses it.

### `MoveToShelfModal` (picker)
A modal listing shelves as a radio group (the book's current shelf pre-selected), plus
**＋ New shelf…** and **Remove from shelf**. Selecting a shelf calls
`assignBook(bookId, shelfId)`; Remove calls `assignBook(bookId, null)`; New shelf opens
the name-input modal, creates the shelf, and assigns the book to it.

### `ShelfNameModal` (create / rename)
A small modal with a single `TextInput` + Save/Cancel. Used for both **New shelf** and
**Rename** (`Alert.prompt` is unreliable on Android, so a real modal is used). Confirm
dialogs (delete shelf) use `Alert` imported from `@/lib/alert` (the web shim — never
from `react-native`).

## Library page integration (`library.tsx`, `EpubLibrary`)

- Load shelves + assignments alongside `items` in the `useFocusEffect` reload.
- Replace the flat `FlatList` grid with the vertical list of `Shelf` bands built from
  `groupIntoShelves(...)`. (The empty-library state — no books at all — is unchanged.)
- Add a **`＋ New shelf`** button to the header row (beside **Import EPUB**).
- After any shelf mutation (create/rename/delete/assign), re-read shelves + assignments
  and re-render.
- `handleDelete` also calls `pruneBook(id)`.

`DemoLibrary` is untouched.

## Error handling & edge cases

- Malformed stored JSON → treated as empty (`[]` / `{}`), matching `epubLibrary`.
- Assignment pointing at a deleted shelf → book renders as Unshelved (belt-and-suspenders
  alongside `deleteShelf` pruning).
- Duplicate shelf names → allowed (ids are unique); no uniqueness constraint.
- Empty/whitespace shelf name → rejected by create/rename (Save disabled / no-op).
- Deleting a book prunes its assignment so no orphan keys accumulate.
- Web vs native: all shelf state is small JSON via AsyncStorage, identical on both; the
  EPUB blobs continue to live in their existing per-platform stores untouched.

## Testing

Following `mobile/__tests__/storage`:

- **`shelfStore`**: create (order increments), rename (trim, reject empty), delete
  (shelf gone + its books unshelved, other shelves untouched), `assignBook`
  (set / reassign keeps a single entry / `null` removes), `pruneBook`, malformed-JSON
  resilience.
- **`groupIntoShelves`**: empty shelves included; Unshelved catches unassigned + stale
  pointers; per-section `compiledAt desc`; empty Unshelved omitted.
- **Components**: `BookSpine` (deterministic color/height, tap fires callback),
  `Shelf` (empty-state hint, name menu), `MoveToShelfModal` (pre-selects current,
  calls `assignBook` correctly).

No live network / Redis / Anthropic (CLAUDE.md testing rule).

## Files

**New**
- `mobile/src/storage/shelfStore.ts`
- `mobile/src/components/Shelf.tsx`
- `mobile/src/components/BookSpine.tsx`
- `mobile/src/components/MoveToShelfModal.tsx`
- `mobile/src/components/ShelfNameModal.tsx`
- `mobile/src/lib/groupShelves.ts` (the `groupIntoShelves` helper)
- Matching tests under `mobile/__tests__/`.

**Modified**
- `mobile/app/(tabs)/library.tsx` — `EpubLibrary` rendering, header button, delete prune.

## Non-goals / future

Manual shelf reordering, drag-and-drop, shelves in the demo build, and syncing shelves
across devices are deferred. If library sync is later built, shelves would sync as part
of the same zero-knowledge library payload (out of scope here).
