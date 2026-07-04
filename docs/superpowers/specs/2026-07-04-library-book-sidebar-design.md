# Library — Metadata Sidebar on Tap Design Spec

**Date:** 2026-07-04
**Status:** Approved (brainstorm)
**Feature:** Tapping a book on a shelf opens the metadata sidebar (single action surface); the inline pull-out is removed.

## Summary

Follow-up UX change to the shelves feature. On the shelf, book **spines** are compact
and their binding text is small/hard to read. Instead of relying on the pulled-out
inline card, **tapping a spine opens the metadata sidebar** — the existing right-docked,
non-blocking `BookMetadataModal` — which shows the book's details in a readable panel and
now also carries all of the book's actions. The inline **pull-out is removed entirely**.

This brings back the old grid's tap-to-see-metadata behavior and makes the sidebar the
single place a user reads about and acts on a book.

## Scope

**In scope**
- Non-demo `EpubLibrary` shelf view.
- `ShelfBook` (spine only), `ShelfBand` (drop expanded plumbing), `BookMetadataModal`
  (gain export status + action footer), `library.tsx` wiring.

**Out of scope**
- Demo Library (`DemoLibrary`) — unchanged.
- Spine sizing / adding a title label under spines — the sidebar solves readability; spines
  stay as compact tap-targets.
- Any storage/model change — `shelfStore`, `groupIntoShelves`, `MoveToShelfModal`,
  `ShelfNameModal` are unchanged.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | **Tap a spine → open the metadata sidebar** (existing `BookMetadataModal`). It is non-blocking and re-points when another spine is tapped (existing behavior — kept). |
| 2 | **Remove the inline pull-out entirely.** `ShelfBook` renders only the spine. |
| 3 | **Sidebar is the single action surface.** Footer gains `Read · Move to shelf · 💬 Reviews · 🗑 Delete · Close`. |
| 4 | **Export/published status moves into the sidebar** (the `ExportStatusPills` that were on the pull-out), shown near the title. Once spines are the only shelf visual, this info has nowhere else to live. |
| 5 | **Delete from the sidebar confirms** via a 2-button `Alert` (`@/lib/alert`) — more prominent than the old tiny trash icon, so a mis-tap guard is warranted. Move/Reviews/Read do not confirm. |
| 6 | **Sidebar stays metadata-only — no cover thumbnail** (matches the old grid sidebar; keeps it lean). |

## Behavior

- Tapping a spine calls the existing `openMeta(item)` in `library.tsx`, which loads the
  full `Book` lazily and points the sidebar at it (imported EPUBs show the minimal
  fallback metadata — unchanged).
- The sidebar's **Read** → existing `openItem` (in-app reader for authored books; OS share
  sheet for `imported-*`).
- **Move to shelf** → opens the existing `MoveToShelfModal` for the selected book
  (`setMoveTarget(item)`), pre-selecting the book's current shelf.
- **💬 Reviews** → existing `openReviews(item)`; shows the review count as a badge when > 0.
- **🗑 Delete** → 2-button confirm; on confirm, existing `handleDelete(item.id)` (which
  already deletes the EPUB and prunes the shelf assignment).
- **Close** → closes the sidebar (existing `closeMeta`).

## Components

### `ShelfBook` (`src/components/ShelfBook.tsx`) — simplified
Renders **only** the spine. Drop the `expanded` prop and its entire pulled-out branch
(`BookCover`, `ExportStatusPills`, the action row) and their now-unused imports. Keep the
exported `spineStyleFor(id)` (deterministic color/height) and `overflow: "hidden"` on the
spine. New prop shape:

```ts
export function ShelfBook(props: {
  meta: EpubMeta;
  onPress: () => void;   // tap → parent opens the sidebar
}): JSX.Element;
```

### `ShelfBand` (`src/components/ShelfBand.tsx`) — simplified
Drop `expandedId`, `onExpand`, and the per-book action props (`onRead`, `onReviews`,
`onMove`, `onDetails`, `onDelete`), plus the `counts`/`exportStatus` props it only passed
into the pulled-out `ShelfBook`. Keep `shelf`, `books`, and the shelf-level props
(`onRename`, `onDeleteShelf`). Add one book-level prop `onPressBook(meta)`; each spine's
`onPress` calls it. Header/plank/rack/empty-hint unchanged.

### `BookMetadataModal` (`src/components/BookMetadataModal.tsx`) — the sidebar, extended
Keep the docked-panel layout and metadata rows. Additions:
- Show `ExportStatusPills` (with `status` + `published`) under the title.
- Extend props and footer:

```ts
export interface BookMetadataModalProps {
  visible: boolean;
  book: Book | null;
  meta: BookMetaFallback | null;
  loading?: boolean;
  // NEW:
  exportStatus?: BookExportStatus;
  published?: PublishedFormats;
  reviewCount?: number;
  onRead: () => void;
  onMove: () => void;      // NEW → opens MoveToShelfModal
  onReviews: () => void;   // NEW
  onDelete: () => void;    // NEW → parent shows the confirm Alert, then deletes
  onClose: () => void;
}
```

Footer buttons: `Read` (primary) · `Move to shelf` · `💬 Reviews` (with count badge) ·
`🗑 Delete` · `Close`. `deriveRows` is unchanged.

The delete confirm lives in `library.tsx` (the parent owns `Alert` + `handleDelete`), so
`onDelete` here just invokes the parent's confirm-then-delete handler.

### `library.tsx` (`app/(tabs)/library.tsx`) — rewire
- `ShelfBand` gets `onPressBook={openMeta}` instead of the removed `onExpand`/action props;
  delete `expandedId` state and its `setExpandedId` calls.
- Pass the sidebar the new props: `exportStatus={selected ? exportStatus[selected.id] : undefined}`,
  `published={selected ? published[selected.id] : undefined}`,
  `reviewCount={selected ? counts[selected.id] : undefined}`, and handlers
  `onMove={() => selected && setMoveTarget(selected)}`,
  `onReviews={() => selected && openReviews(selected)}`,
  `onDelete={() => selected && confirmDeleteBook(selected)}`.
- Add `confirmDeleteBook(item)`: a 2-button `Alert` (`@/lib/alert`) → on confirm
  `handleDelete(item.id)` then `closeMeta()`.
- `MoveToShelfModal`'s `currentShelfId` for the selected book derives from
  `assignments[selected.id] ?? null` (mirrors the existing `moveTarget` derivation).

## Error handling & edge cases

- Imported EPUBs (no in-app `Book`): sidebar shows fallback metadata (title + compiled
  date) — unchanged; Read routes to the share sheet; Move/Delete still apply.
- Deleting the currently-open book closes the sidebar (`closeMeta` after `handleDelete`).
- Tapping a different spine while the sidebar is open re-points it (existing non-blocking
  overlay behavior — no dismiss needed).
- Export status / published absent → `ExportStatusPills` renders its neutral "not exported"
  state (existing behavior).

## Testing

- **`ShelfBook`**: trim to the spine — `spineStyleFor` determinism + tap fires `onPress`.
  Remove the expanded-state assertions.
- **`ShelfBand`**: drop expanded-related assertions; assert a spine tap calls `onPressBook`.
- **`BookMetadataModal`**: existing `deriveRows`/render tests stay; add assertions that the
  footer renders and `Read`/`Move to shelf`/`Reviews`/`Delete` fire their handlers, and that
  the export pills render when `exportStatus`/`published` are passed.
- **`library.tsx`**: manual live verification (web + Android) — tap spine → sidebar with
  metadata + actions; Move/Reviews/Delete/Read work; delete confirms.

## Files

**Modified**
- `mobile/src/components/ShelfBook.tsx` (simplify to spine)
- `mobile/src/components/ShelfBand.tsx` (drop expanded plumbing; `onPressBook`)
- `mobile/src/components/BookMetadataModal.tsx` (export pills + action footer)
- `mobile/app/(tabs)/library.tsx` (rewire tap→sidebar; sidebar action props; `confirmDeleteBook`)
- Matching test updates under `mobile/__tests__/`.

## Non-goals / future

Spine legibility tweaks (wider spines, under-spine labels), a cover thumbnail in the
sidebar, and any drag/reorder remain out of scope.
