# Library Metadata-Sidebar-on-Tap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a book spine on a shelf opens the metadata sidebar (a single readable panel carrying the book's actions), replacing the small inline pull-out.

**Architecture:** A follow-up UX change to the shipped shelves feature. `BookMetadataModal` (already a right-docked, non-blocking sidebar) gains the export/published pills and an action footer (Read / Move / Reviews / Delete). `ShelfBook` collapses to just the spine, `ShelfBand` drops its expanded/action plumbing, and `library.tsx` wires a spine tap to the existing `openMeta` and feeds the sidebar the handlers it already has.

**Tech Stack:** React Native + Expo, TypeScript, Jest + @testing-library/react-native.

## Global Constraints

- **Theme tokens from `@/constants/theme`** — no new hardcoded colors (the sidebar's existing `#000`/`rgba` shadow/scrim literals stay).
- **`Alert` from `@/lib/alert`** (never `react-native`); the delete-from-sidebar confirm is a **2-button** Alert (Cancel + Delete) — the web shim only supports 2-button dialogs.
- **Reuse existing types:** `EpubMeta` (`@/storage/epubLibrary`), `BookExportStatus` (`@/storage/exportStatus`), `PublishedFormats` (`@/lib/trackedExport`), `Book` (`@/types/book`).
- **Demo Library (`DemoLibrary`) untouched.** No storage/model change — `shelfStore`, `groupIntoShelves`, `MoveToShelfModal`, `ShelfNameModal` are not modified.
- Run commands from `mobile/`. Test: `npx jest <path>`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.

---

### Task 1: Extend `BookMetadataModal` — export pills + action footer

Additive change: new props are **optional**, so `library.tsx` (not yet passing them) keeps compiling. Task 2 wires them.

**Files:**
- Modify: `mobile/src/components/BookMetadataModal.tsx`
- Test: `mobile/__tests__/components/BookMetadataModal.test.tsx`

**Interfaces:**
- Consumes: `ExportStatusPills` from `@/components/ExportStatusPills`; `BookExportStatus`; `PublishedFormats`; `Ionicons`.
- Produces:
  ```ts
  export interface BookMetadataModalProps {
    visible: boolean;
    book: Book | null;
    meta: BookMetaFallback | null;
    loading?: boolean;
    exportStatus?: BookExportStatus;
    published?: PublishedFormats;
    reviewCount?: number;
    onRead: () => void;
    onMove?: () => void;     // renders the Move button only when provided
    onReviews?: () => void;  // renders the Reviews button only when provided
    onDelete?: () => void;   // renders the Delete button only when provided
    onClose: () => void;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `mobile/__tests__/components/BookMetadataModal.test.tsx` (keep the existing `deriveRows` and `BookMetadataModal` describes as-is):

```tsx
describe("BookMetadataModal — export pills + actions", () => {
  const fallback = { title: "Product Sense and AI", compiledAt: "2026-06-01T00:00:00.000Z" };

  it("renders the action footer and fires Move / Reviews / Delete", () => {
    const onMove = jest.fn();
    const onReviews = jest.fn();
    const onDelete = jest.fn();
    render(
      <BookMetadataModal
        visible
        book={FULL_BOOK}
        meta={fallback}
        reviewCount={3}
        onRead={jest.fn()}
        onMove={onMove}
        onReviews={onReviews}
        onDelete={onDelete}
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText("Move to shelf"));
    fireEvent.press(screen.getByLabelText("Reviews"));
    fireEvent.press(screen.getByLabelText("Delete from library"));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onReviews).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("omits action buttons when their handlers are not provided", () => {
    render(<BookMetadataModal visible book={FULL_BOOK} meta={fallback} onRead={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByLabelText("Move to shelf")).toBeNull();
    expect(screen.queryByLabelText("Delete from library")).toBeNull();
  });

  it("shows the export pills (EPUB/PDF) when status/published are passed", () => {
    render(
      <BookMetadataModal
        visible
        book={FULL_BOOK}
        meta={fallback}
        exportStatus={{ epub: { state: "done", compiledAt: "2026-07-04T00:00:00Z" } }}
        published={{ epub: true }}
        onRead={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText("EPUB")).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/BookMetadataModal.test.tsx`
Expected: FAIL — `getByLabelText("Move to shelf")` finds nothing (buttons/pills not implemented yet).

- [ ] **Step 3: Implement the changes**

In `mobile/src/components/BookMetadataModal.tsx`:

(a) Add imports after the existing `react-native` import block:

```tsx
import { Ionicons } from "@expo/vector-icons";
import { ExportStatusPills } from "@/components/ExportStatusPills";
import type { BookExportStatus } from "@/storage/exportStatus";
import type { PublishedFormats } from "@/lib/trackedExport";
```

(b) Replace the `BookMetadataModalProps` interface with:

```tsx
export interface BookMetadataModalProps {
  visible: boolean;
  book: Book | null;
  meta: BookMetaFallback | null;
  loading?: boolean;
  // Export/published availability, shown under the title (moved here from the
  // old shelf pull-out — spines are now the only shelf visual).
  exportStatus?: BookExportStatus;
  published?: PublishedFormats;
  reviewCount?: number;
  onRead: () => void;
  // Action buttons render only when their handler is provided, so the sidebar
  // degrades gracefully (and this change stays additive for callers).
  onMove?: () => void;
  onReviews?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}
```

(c) Replace the component's destructured params and its `return (...)` body. New signature params:

```tsx
export function BookMetadataModal({
  visible,
  book,
  meta,
  loading = false,
  exportStatus,
  published,
  reviewCount,
  onRead,
  onMove,
  onReviews,
  onDelete,
  onClose,
}: BookMetadataModalProps) {
```

Inside the `<View style={styles.sidebar}>`, immediately after the `<Text style={styles.title}>` block, insert the pills:

```tsx
        <ExportStatusPills status={exportStatus} published={published} />
```

Replace the existing `<View style={styles.footer}>…</View>` block with:

```tsx
        <View style={styles.footer}>
          <View style={styles.actions}>
            <Pressable style={styles.readBtn} onPress={onRead} accessibilityRole="button" accessibilityLabel="Read this book">
              <Text style={styles.readBtnText}>Read</Text>
            </Pressable>
            {onMove ? (
              <Pressable style={styles.iconBtn} onPress={onMove} accessibilityRole="button" accessibilityLabel="Move to shelf" hitSlop={8}>
                <Ionicons name="folder-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            ) : null}
            {onReviews ? (
              <Pressable style={styles.iconBtn} onPress={onReviews} accessibilityRole="button" accessibilityLabel="Reviews" hitSlop={8}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.textSecondary} />
                {reviewCount ? <Text style={styles.count}>{reviewCount}</Text> : null}
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable style={styles.iconBtn} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete from library" hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
```

(d) Replace the `footer`, `closeBtn`, `readBtn` style entries and add `actions`, `iconBtn`, `count`. The final relevant style block:

```tsx
  footer: { gap: spacing.sm, marginTop: spacing.xs },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  count: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.textSecondary },
  closeBtn: {
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  closeBtnText: { color: colors.textSecondary, fontWeight: "700", fontSize: typography.sizeSm },
  readBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  readBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
```

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `npx jest __tests__/components/BookMetadataModal.test.tsx`
Expected: PASS (existing `deriveRows`/`Read`/`Close`/loading tests + the 3 new ones).

Run: `npm run typecheck`
Expected: clean (library.tsx still compiles — new props are optional).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/BookMetadataModal.tsx mobile/__tests__/components/BookMetadataModal.test.tsx
git commit -m "feat(library): metadata sidebar gains export pills + action footer"
```

---

### Task 2: Spine-only `ShelfBook`, simplified `ShelfBand`, and `library.tsx` tap→sidebar rewire

One coupled task: removing `ShelfBook`'s `expanded`/action props forces matching changes in `ShelfBand` and `library.tsx` in the same commit to keep the tree compiling.

**Files:**
- Modify: `mobile/src/components/ShelfBook.tsx`
- Modify: `mobile/src/components/ShelfBand.tsx`
- Modify: `mobile/app/(tabs)/library.tsx`
- Test: `mobile/__tests__/components/ShelfBook.test.tsx`
- Test: `mobile/__tests__/components/ShelfBand.test.tsx`

**Interfaces:**
- Consumes: `BookMetadataModal` new props from Task 1 (`exportStatus`, `published`, `reviewCount`, `onMove`, `onReviews`, `onDelete`); `spineStyleFor` (unchanged export).
- Produces:
  ```ts
  export function ShelfBook(props: { meta: EpubMeta; onPress: () => void }): JSX.Element;
  export function spineStyleFor(id: string): { backgroundColor: string; height: number }; // unchanged
  export function ShelfBand(props: {
    shelf: Shelf | null;
    books: EpubMeta[];
    onPressBook: (m: EpubMeta) => void;
    onRename: () => void;
    onDeleteShelf: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write/adjust the failing component tests**

Replace `mobile/__tests__/components/ShelfBook.test.tsx` entirely with:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBook, spineStyleFor } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";

const meta: EpubMeta = { id: "book-quantum", title: "Quantum Mechanics", sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" };

it("spineStyleFor is deterministic for a given id", () => {
  expect(spineStyleFor("book-quantum")).toEqual(spineStyleFor("book-quantum"));
  expect(spineStyleFor("a").backgroundColor).toBeDefined();
  expect(spineStyleFor("a").height).toBeGreaterThanOrEqual(96);
});

it("renders the spine and fires onPress when tapped", () => {
  const onPress = jest.fn();
  render(<ShelfBook meta={meta} onPress={onPress} />);
  fireEvent.press(screen.getByLabelText("Open: Quantum Mechanics"));
  expect(onPress).toHaveBeenCalledTimes(1);
});
```

Replace `mobile/__tests__/components/ShelfBand.test.tsx` entirely with:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBand } from "@/components/ShelfBand";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";

const shelf: Shelf = { id: "s1", name: "Physics", createdAt: "2026-07-04T00:00:00Z", order: 0 };
const book = (id: string): EpubMeta => ({ id, title: id, sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" });

const handlers = { onPressBook: jest.fn(), onRename: jest.fn(), onDeleteShelf: jest.fn() };

function renderBand(overrides: Partial<React.ComponentProps<typeof ShelfBand>> = {}) {
  return render(<ShelfBand shelf={shelf} books={[book("b1")]} {...handlers} {...overrides} />);
}

beforeEach(() => Object.values(handlers).forEach((h) => h.mockClear()));

it("renders the shelf name and its books", () => {
  renderBand();
  expect(screen.getByText("Physics")).toBeTruthy();
  expect(screen.getByLabelText("Open: b1")).toBeTruthy();
});

it("tapping a spine calls onPressBook", () => {
  renderBand();
  fireEvent.press(screen.getByLabelText("Open: b1"));
  expect(handlers.onPressBook).toHaveBeenCalled();
});

it("shows an empty-shelf hint when the shelf has no books", () => {
  renderBand({ books: [] });
  expect(screen.getByText(/No books yet/i)).toBeTruthy();
});

it("rename and delete controls fire for a real shelf", () => {
  renderBand();
  fireEvent.press(screen.getByLabelText("Rename shelf: Physics"));
  fireEvent.press(screen.getByLabelText("Delete shelf: Physics"));
  expect(handlers.onRename).toHaveBeenCalled();
  expect(handlers.onDeleteShelf).toHaveBeenCalled();
});

it("the Unshelved band has no rename/delete controls", () => {
  renderBand({ shelf: null });
  expect(screen.getByText("Unshelved")).toBeTruthy();
  expect(screen.queryByLabelText(/Rename shelf/)).toBeNull();
  expect(screen.queryByLabelText(/Delete shelf/)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/ShelfBook.test.tsx __tests__/components/ShelfBand.test.tsx`
Expected: FAIL — current `ShelfBook`/`ShelfBand` still require the removed props; the new `onPress`/`onPressBook` contracts aren't implemented (type/prop errors or missing labels).

- [ ] **Step 3: Simplify `ShelfBook` to the spine only**

Replace the entire contents of `mobile/src/components/ShelfBook.tsx` with:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { EpubMeta } from "@/storage/epubLibrary";
import { colors, spacing } from "@/constants/theme";

// Warm spine palette (shelf visual direction "A" — saturated, bookshelf-real).
const SPINE_PALETTE = ["#c14b3a", "#3a7d55", "#b8892b", "#4a5bbf", "#8a4bb0", "#c07a2b", "#487d8a"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic spine colour + height from the book id, so a book looks the
// same across renders and books on a shelf vary naturally (96–128px tall).
export function spineStyleFor(id: string): { backgroundColor: string; height: number } {
  const h = hashId(id);
  return { backgroundColor: SPINE_PALETTE[h % SPINE_PALETTE.length], height: 96 + (h % 5) * 8 };
}

// A book on a shelf: just the spine. Tapping it opens the metadata sidebar
// (BookMetadataModal), which carries the cover-less detail view + actions.
export function ShelfBook({ meta, onPress }: { meta: EpubMeta; onPress: () => void }): JSX.Element {
  const s = spineStyleFor(meta.id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open: ${meta.title}`}
      style={[styles.spine, { backgroundColor: s.backgroundColor, height: s.height }]}
    >
      <Text style={styles.spineText} numberOfLines={1}>
        {meta.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  spine: {
    width: 30,
    borderRadius: 3,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.sm,
    overflow: "hidden",
  },
  spineText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "700",
    // Title runs down the binding.
    transform: [{ rotate: "90deg" }],
    width: 110,
    textAlign: "center",
  },
});
```

- [ ] **Step 4: Simplify `ShelfBand`**

Replace the entire contents of `mobile/src/components/ShelfBand.tsx` with:

```tsx
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ShelfBook } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";
import { colors, spacing, typography } from "@/constants/theme";

export function ShelfBand({
  shelf,
  books,
  onPressBook,
  onRename,
  onDeleteShelf,
}: {
  shelf: Shelf | null;
  books: EpubMeta[];
  onPressBook: (m: EpubMeta) => void;
  onRename: () => void;
  onDeleteShelf: () => void;
}): JSX.Element {
  const name = shelf ? shelf.name : "Unshelved";
  return (
    <View style={styles.band}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.count}>
          {books.length} {books.length === 1 ? "book" : "books"}
        </Text>
        {shelf ? (
          <View style={styles.headerActions}>
            <Pressable onPress={onRename} accessibilityRole="button" accessibilityLabel={`Rename shelf: ${name}`} hitSlop={8}>
              <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={onDeleteShelf} accessibilityRole="button" accessibilityLabel={`Delete shelf: ${name}`} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {books.length === 0 ? (
        <Text style={styles.emptyHint}>No books yet — move some here.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rack}>
          {books.map((m) => (
            <ShelfBook key={m.id} meta={m} onPress={() => onPressBook(m)} />
          ))}
        </ScrollView>
      )}

      {/* Warm-wood plank the spines rest on. */}
      <View style={styles.plank} />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  name: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text, flexShrink: 1 },
  count: { fontSize: typography.sizeXs, color: colors.textMuted },
  headerActions: { flexDirection: "row", gap: spacing.md, marginLeft: "auto" },
  rack: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, minHeight: 132, paddingHorizontal: spacing.xs },
  emptyHint: { fontSize: typography.sizeSm, color: colors.textMuted, fontStyle: "italic", paddingVertical: spacing.lg, paddingHorizontal: spacing.xs },
  plank: {
    height: 12,
    borderRadius: 2,
    backgroundColor: "#5a3d26", // warm wood
    marginHorizontal: -spacing.xs,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});
```

- [ ] **Step 5: Rewire `library.tsx`**

In `mobile/app/(tabs)/library.tsx`:

(a) Delete the `expandedId` state line (`const [expandedId, setExpandedId] = useState<string | null>(null);`).

(b) In `handleDelete`, delete the trailing `setExpandedId(null);` line (the last statement in its body).

(c) Add a `confirmDeleteBook` handler immediately after `openReviews` (before `const currentShelfId = …`):

```tsx
  const confirmDeleteBook = useCallback(
    (item: EpubMeta) => {
      Alert.alert("Delete from library?", `“${item.title}” will be removed from this device.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void handleDelete(item.id);
            closeMeta();
          },
        },
      ]);
    },
    [handleDelete, closeMeta],
  );
```

(d) Replace the `<ShelfBand … />` inside the `FlatList` `renderItem` with the trimmed prop set:

```tsx
      renderItem={({ item: sec }) => (
        <ShelfBand
          shelf={sec.shelf}
          books={sec.books}
          onPressBook={openMeta}
          onRename={() => sec.shelf && setNameModal({ mode: "rename", shelf: sec.shelf })}
          onDeleteShelf={() => sec.shelf && confirmDeleteShelf(sec.shelf)}
        />
      )}
```

(e) Replace the `<BookMetadataModal … />` in the `return` with the action-wired version:

```tsx
      <BookMetadataModal
        visible={!!selected}
        book={selectedBook}
        meta={selected ? { title: selected.title, compiledAt: selected.compiledAt } : null}
        loading={loadingBook}
        exportStatus={selected ? exportStatus[selected.id] : undefined}
        published={selected ? published[selected.id] : undefined}
        reviewCount={selected ? counts[selected.id] : undefined}
        onRead={() => {
          const item = selected;
          closeMeta();
          if (item) openItem(item);
        }}
        onMove={() => selected && setMoveTarget(selected)}
        onReviews={() => {
          const item = selected;
          closeMeta();
          if (item) openReviews(item);
        }}
        onDelete={() => selected && confirmDeleteBook(selected)}
        onClose={closeMeta}
      />
```

(f) After editing, run typecheck/lint (Step 6) and delete any symbol they flag as now-unused. (Expected: none — `counts`, `exportStatus`, `published` still feed the sidebar; `openReviews`, `openItem`, `setMoveTarget` still used.)

- [ ] **Step 6: Typecheck, lint, and run the suite**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run lint`
Expected: no new warnings in the four edited files.

Run: `npx jest`
Expected: full suite green (the rewritten `ShelfBook`/`ShelfBand` tests + everything else).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/components/ShelfBook.tsx mobile/src/components/ShelfBand.tsx mobile/app/\(tabs\)/library.tsx mobile/__tests__/components/ShelfBook.test.tsx mobile/__tests__/components/ShelfBand.test.tsx
git commit -m "feat(library): tap a spine opens the metadata sidebar; drop the pull-out"
```

- [ ] **Step 8: Manual live verification (controller)**

Web (`npx expo start --web`) and Android emulator: tap a spine → the sidebar opens with metadata + export pills + the footer (Read / Move / Reviews / Delete / Close). Verify: tapping another spine re-points the sidebar; Move opens the shelf picker and reassigns; Reviews navigates; Delete confirms then removes the book and closes the sidebar; Read opens the reader. Confirm no inline pull-out appears.

---

## Self-Review

**Spec coverage:**
- Tap spine → open metadata sidebar → Task 2 (`onPressBook={openMeta}`). ✔
- Remove inline pull-out → Task 2 (`ShelfBook` spine-only). ✔
- Sidebar = single action surface (Read/Move/Reviews/Delete/Close) → Task 1 footer + Task 2 wiring. ✔
- Export/published pills move into the sidebar → Task 1 (`ExportStatusPills` under title) + Task 2 (passes `exportStatus`/`published`). ✔
- Delete-from-sidebar confirms via 2-button Alert → Task 2 `confirmDeleteBook`. ✔
- Sidebar metadata-only, no cover thumbnail → Task 1 (no `BookCover`). ✔
- `ShelfBand` drops expanded plumbing; `library.tsx` drops `expandedId` → Task 2. ✔
- Demo Library / storage / `MoveToShelfModal` / `ShelfNameModal` untouched → not in any task's file list. ✔

**Placeholder scan:** No TBD/TODO; full code in every code step; real assertions in every test. ✔

**Type consistency:** `ShelfBook({meta, onPress})`, `ShelfBand({shelf, books, onPressBook, onRename, onDeleteShelf})`, and the `BookMetadataModalProps` additions match between producer (Task 1/2) and consumer (`library.tsx` in Task 2). `spineStyleFor` signature unchanged. `PublishedFormats`/`BookExportStatus` reused from their existing modules. ✔
