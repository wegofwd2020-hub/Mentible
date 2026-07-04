# Library Shelves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user group their Library books into named shelves (one shelf per book), rendered as spines racked on a warm-wood shelf that pull out to reveal a cover + actions.

**Architecture:** A device-local organizational overlay on the existing flat `EpubLibrary`. A new `shelfStore` keeps two small AsyncStorage JSON values (a `Shelf[]` and a `bookId→shelfId` map); a pure `groupIntoShelves` helper turns books + shelves + assignments into ordered render sections; new presentational components (`ShelfBand`, `ShelfBook`, `MoveToShelfModal`, `ShelfNameModal`) render them; `library.tsx` wires it together. No backend, no sync, demo Library untouched.

**Tech Stack:** React Native + Expo, TypeScript, AsyncStorage, Jest + @testing-library/react-native.

## Global Constraints

- **Device-local only.** Shelf state is small JSON in AsyncStorage — never blobs, never backend, no sync. (CLAUDE.md D4: library is local-first at MVP.)
- **`randomUUID()` from `@/lib/uuid`** — never `crypto.randomUUID()` (Hermes has no global crypto).
- **`Alert` from `@/lib/alert`** — never from `react-native` (the web shim maps to `window.confirm/alert`). The shim collapses any dialog with 3+ buttons to action-vs-cancel, so **use only 2-button (confirm/cancel) Alerts**; expose multi-way choices as explicit on-screen controls, not nested Alert menus.
- **Theme tokens** from `@/constants/theme` (`colors`, `spacing`, `radius`, `typography`) — no hardcoded colors except the fixed warm spine palette defined in Task 3.
- **Demo Library (`DemoLibrary` in `library.tsx`) is out of scope** — do not modify it.
- **Tests never hit live network / Redis / Anthropic.** Mock storage via the real AsyncStorage mock (as existing storage tests do — `AsyncStorage.clear()` in `beforeEach`).
- Run all commands from `mobile/`. Test: `npx jest <path>`. Typecheck: `npm run typecheck`.

---

### Task 1: `shelfStore` — persistence + CRUD + assignment

**Files:**
- Create: `mobile/src/storage/shelfStore.ts`
- Test: `mobile/__tests__/storage/shelfStore.test.ts`

**Interfaces:**
- Consumes: `randomUUID` from `@/lib/uuid`; `AsyncStorage`.
- Produces:
  ```ts
  export interface Shelf { id: string; name: string; createdAt: string; order: number; }
  export function listShelves(): Promise<Shelf[]>;                 // sorted by order asc
  export function createShelf(name: string): Promise<Shelf>;       // appended; throws on empty name
  export function renameShelf(id: string, name: string): Promise<void>; // throws on empty name
  export function deleteShelf(id: string): Promise<void>;          // removes shelf + unshelves its books
  export function getAssignments(): Promise<Record<string, string>>;
  export function assignBook(bookId: string, shelfId: string | null): Promise<void>; // null = unshelve
  export function pruneBook(bookId: string): Promise<void>;        // drop a deleted book's assignment
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/storage/shelfStore.test.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  assignBook,
  createShelf,
  deleteShelf,
  getAssignments,
  listShelves,
  pruneBook,
  renameShelf,
} from "@/storage/shelfStore";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("shelfStore — shelves", () => {
  it("creates shelves with incrementing order", async () => {
    const a = await createShelf("Physics");
    const b = await createShelf("Chemistry");
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(a.id).not.toBe(b.id);
    const list = await listShelves();
    expect(list.map((s) => s.name)).toEqual(["Physics", "Chemistry"]);
  });

  it("trims names and rejects empty ones", async () => {
    const s = await createShelf("  Biology  ");
    expect(s.name).toBe("Biology");
    await expect(createShelf("   ")).rejects.toThrow();
  });

  it("renames a shelf and rejects an empty rename", async () => {
    const s = await createShelf("Phys");
    await renameShelf(s.id, "Physics");
    expect((await listShelves())[0].name).toBe("Physics");
    await expect(renameShelf(s.id, "  ")).rejects.toThrow();
  });

  it("returns shelves sorted by order regardless of stored order", async () => {
    const a = await createShelf("A");
    const b = await createShelf("B");
    // Persist them reversed to prove listShelves sorts.
    await AsyncStorage.setItem("sbq_shelves", JSON.stringify([b, a]));
    expect((await listShelves()).map((s) => s.order)).toEqual([0, 1]);
  });

  it("survives malformed stored JSON", async () => {
    await AsyncStorage.setItem("sbq_shelves", "{not json");
    expect(await listShelves()).toEqual([]);
    await AsyncStorage.setItem("sbq_shelf_assignments", "nope");
    expect(await getAssignments()).toEqual({});
  });
});

describe("shelfStore — assignments", () => {
  it("assigns, reassigns (one shelf at a time), and unshelves", async () => {
    await assignBook("book1", "shelfA");
    expect(await getAssignments()).toEqual({ book1: "shelfA" });
    await assignBook("book1", "shelfB"); // reassign replaces, never duplicates
    expect(await getAssignments()).toEqual({ book1: "shelfB" });
    await assignBook("book1", null); // unshelve removes the key
    expect(await getAssignments()).toEqual({});
  });

  it("pruneBook drops only that book's assignment", async () => {
    await assignBook("b1", "s1");
    await assignBook("b2", "s1");
    await pruneBook("b1");
    expect(await getAssignments()).toEqual({ b2: "s1" });
  });

  it("deleteShelf removes the shelf and unshelves its books, leaving others", async () => {
    const s1 = await createShelf("S1");
    const s2 = await createShelf("S2");
    await assignBook("b1", s1.id);
    await assignBook("b2", s1.id);
    await assignBook("b3", s2.id);
    await deleteShelf(s1.id);
    expect((await listShelves()).map((s) => s.id)).toEqual([s2.id]);
    expect(await getAssignments()).toEqual({ b3: s2.id }); // b1,b2 unshelved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/storage/shelfStore.test.ts`
Expected: FAIL — cannot find module `@/storage/shelfStore`.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/storage/shelfStore.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "@/lib/uuid";

// Named shelves the user groups Library books into. A device-local
// organizational overlay only — small JSON, no blobs, no backend, no sync
// (mirrors the settingsStore/exportStatus local-first pattern). Book blobs
// stay in epubLibrary; this stores just the shelf labels and a
// bookId → shelfId map. Keying the map by bookId makes "one shelf per book"
// structural: a book id has exactly one value.

const SHELVES_KEY = "sbq_shelves";
const ASSIGN_KEY = "sbq_shelf_assignments";

export interface Shelf {
  id: string;
  name: string;
  createdAt: string; // ISO
  order: number; // ascending; new shelves get max(order)+1
}

type Assignments = Record<string, string>; // bookId → shelfId

async function readShelves(): Promise<Shelf[]> {
  const raw = await AsyncStorage.getItem(SHELVES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Shelf[];
  } catch {
    return [];
  }
}

async function writeShelves(shelves: Shelf[]): Promise<void> {
  await AsyncStorage.setItem(SHELVES_KEY, JSON.stringify(shelves));
}

async function readAssignments(): Promise<Assignments> {
  const raw = await AsyncStorage.getItem(ASSIGN_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Assignments;
  } catch {
    return {};
  }
}

async function writeAssignments(a: Assignments): Promise<void> {
  await AsyncStorage.setItem(ASSIGN_KEY, JSON.stringify(a));
}

export async function listShelves(): Promise<Shelf[]> {
  return (await readShelves()).sort((a, b) => a.order - b.order);
}

export async function createShelf(name: string): Promise<Shelf> {
  const clean = name.trim();
  if (!clean) throw new Error("Shelf name cannot be empty.");
  const shelves = await readShelves();
  const order = shelves.length ? Math.max(...shelves.map((s) => s.order)) + 1 : 0;
  const shelf: Shelf = { id: randomUUID(), name: clean, createdAt: new Date().toISOString(), order };
  await writeShelves([...shelves, shelf]);
  return shelf;
}

export async function renameShelf(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("Shelf name cannot be empty.");
  const shelves = await readShelves();
  await writeShelves(shelves.map((s) => (s.id === id ? { ...s, name: clean } : s)));
}

export async function deleteShelf(id: string): Promise<void> {
  await writeShelves((await readShelves()).filter((s) => s.id !== id));
  const assignments = await readAssignments();
  for (const [bookId, shelfId] of Object.entries(assignments)) {
    if (shelfId === id) delete assignments[bookId];
  }
  await writeAssignments(assignments);
}

export async function getAssignments(): Promise<Assignments> {
  return readAssignments();
}

export async function assignBook(bookId: string, shelfId: string | null): Promise<void> {
  const assignments = await readAssignments();
  if (shelfId === null) delete assignments[bookId];
  else assignments[bookId] = shelfId;
  await writeAssignments(assignments);
}

export async function pruneBook(bookId: string): Promise<void> {
  return assignBook(bookId, null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/storage/shelfStore.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/storage/shelfStore.ts mobile/__tests__/storage/shelfStore.test.ts
git commit -m "feat(library): shelfStore — device-local shelves + book assignment"
```

---

### Task 2: `groupIntoShelves` — books → ordered shelf sections

**Files:**
- Create: `mobile/src/lib/groupShelves.ts`
- Test: `mobile/__tests__/lib/groupShelves.test.ts`

**Interfaces:**
- Consumes: `EpubMeta` from `@/storage/epubLibrary`; `Shelf` from `@/storage/shelfStore` (Task 1).
- Produces:
  ```ts
  export interface ShelfSection { shelf: Shelf | null; books: EpubMeta[]; }
  export function groupIntoShelves(
    items: EpubMeta[],
    shelves: Shelf[],
    assignments: Record<string, string>,
  ): ShelfSection[];
  ```
  Each real shelf (by `order`) becomes a section, empty ones included; a trailing `{ shelf: null, ... }` "Unshelved" section holds books with no assignment or a stale (deleted-shelf) assignment, and is omitted when empty. Book order within a section is the input `items` order (caller pre-sorts by `compiledAt desc`).

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/lib/groupShelves.test.ts`:

```ts
import { groupIntoShelves } from "@/lib/groupShelves";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";

function book(id: string): EpubMeta {
  return { id, title: id, sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" };
}
function shelf(id: string, order: number): Shelf {
  return { id, name: id, createdAt: "2026-07-04T00:00:00Z", order };
}

it("orders shelves by order and includes empty shelves", () => {
  const shelves = [shelf("s2", 1), shelf("s1", 0)];
  const sections = groupIntoShelves([book("b1")], shelves, { b1: "s1" });
  expect(sections.map((sec) => sec.shelf?.id)).toEqual(["s1", "s2", null]);
  expect(sections[0].books.map((b) => b.id)).toEqual(["b1"]);
  expect(sections[1].books).toEqual([]); // s2 empty but present
});

it("puts unassigned and stale-pointer books in a trailing Unshelved section", () => {
  const shelves = [shelf("s1", 0)];
  const sections = groupIntoShelves(
    [book("b1"), book("b2"), book("b3")],
    shelves,
    { b1: "s1", b2: "ghost" }, // b2 points at a deleted shelf, b3 unassigned
  );
  const unshelved = sections.find((sec) => sec.shelf === null);
  expect(unshelved?.books.map((b) => b.id)).toEqual(["b2", "b3"]);
});

it("omits the Unshelved section when every book is shelved", () => {
  const shelves = [shelf("s1", 0)];
  const sections = groupIntoShelves([book("b1")], shelves, { b1: "s1" });
  expect(sections.some((sec) => sec.shelf === null)).toBe(false);
});

it("preserves input book order within a section", () => {
  const shelves = [shelf("s1", 0)];
  const sections = groupIntoShelves([book("z"), book("a")], shelves, { z: "s1", a: "s1" });
  expect(sections[0].books.map((b) => b.id)).toEqual(["z", "a"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/groupShelves.test.ts`
Expected: FAIL — cannot find module `@/lib/groupShelves`.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/lib/groupShelves.ts`:

```ts
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";

export interface ShelfSection {
  shelf: Shelf | null; // null = the trailing "Unshelved" band
  books: EpubMeta[];
}

// Build the ordered list of shelf bands the Library renders: one section per
// shelf (empty shelves included so a freshly-made shelf is visible), then a
// trailing Unshelved band for books with no assignment or a stale pointer to a
// since-deleted shelf. Book order within a band is the caller's input order.
export function groupIntoShelves(
  items: EpubMeta[],
  shelves: Shelf[],
  assignments: Record<string, string>,
): ShelfSection[] {
  const ordered = [...shelves].sort((a, b) => a.order - b.order);
  const validIds = new Set(ordered.map((s) => s.id));
  const byShelf = new Map<string, EpubMeta[]>(ordered.map((s) => [s.id, []]));
  const unshelved: EpubMeta[] = [];

  for (const item of items) {
    const sid = assignments[item.id];
    if (sid && validIds.has(sid)) byShelf.get(sid)!.push(item);
    else unshelved.push(item);
  }

  const sections: ShelfSection[] = ordered.map((s) => ({ shelf: s, books: byShelf.get(s.id)! }));
  if (unshelved.length) sections.push({ shelf: null, books: unshelved });
  return sections;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/groupShelves.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/groupShelves.ts mobile/__tests__/lib/groupShelves.test.ts
git commit -m "feat(library): groupIntoShelves — books into ordered shelf sections"
```

---

### Task 3: `ShelfBook` — spine (collapsed) / pulled-out cover + actions (expanded)

**Files:**
- Create: `mobile/src/components/ShelfBook.tsx`
- Test: `mobile/__tests__/components/ShelfBook.test.tsx`

**Interfaces:**
- Consumes: `EpubMeta` from `@/storage/epubLibrary`; `BookCover` from `@/components/BookCover`; `ExportStatusPills` from `@/components/ExportStatusPills`; `BookExportStatus` from `@/storage/exportStatus`; `Ionicons`; theme tokens.
- Produces:
  ```ts
  export function ShelfBook(props: {
    meta: EpubMeta;
    expanded: boolean;
    reviewCount?: number;
    exportStatus?: BookExportStatus;
    onPressSpine: () => void;   // collapsed spine tapped → parent expands this book
    onRead: () => void;
    onReviews: () => void;
    onMove: () => void;         // open the move-to-shelf picker
    onDetails: () => void;      // open the existing BookMetadataModal
    onDelete: () => void;       // existing delete-from-library flow
  }): JSX.Element;
  ```

**Note (design refinement):** the pulled-out book shows a **flat action row** — Read · reviews · Move · Details · Delete — rather than a nested `⋯` menu. Same actions as the approved `⋯` menu, but `@/lib/alert`'s web shim can't render a 3+-choice menu, so flat controls are the cross-platform-safe form.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/ShelfBook.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBook, spineStyleFor } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";

const meta: EpubMeta = { id: "book-quantum", title: "Quantum Mechanics", sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" };

const noop = () => {};
function renderBook(overrides: Partial<React.ComponentProps<typeof ShelfBook>> = {}) {
  return render(
    <ShelfBook
      meta={meta}
      expanded={false}
      onPressSpine={noop}
      onRead={noop}
      onReviews={noop}
      onMove={noop}
      onDetails={noop}
      onDelete={noop}
      {...overrides}
    />,
  );
}

it("spineStyleFor is deterministic for a given id", () => {
  expect(spineStyleFor("book-quantum")).toEqual(spineStyleFor("book-quantum"));
  expect(spineStyleFor("a").backgroundColor).toBeDefined();
  expect(spineStyleFor("a").height).toBeGreaterThanOrEqual(96);
});

it("collapsed: tapping the spine calls onPressSpine", () => {
  const onPressSpine = jest.fn();
  renderBook({ onPressSpine });
  fireEvent.press(screen.getByLabelText("Open: Quantum Mechanics"));
  expect(onPressSpine).toHaveBeenCalled();
});

it("expanded: shows the action row and fires the right handlers", () => {
  const onRead = jest.fn();
  const onMove = jest.fn();
  const onDelete = jest.fn();
  renderBook({ expanded: true, onRead, onMove, onDelete, reviewCount: 3 });
  fireEvent.press(screen.getByLabelText("Read: Quantum Mechanics"));
  fireEvent.press(screen.getByLabelText("Move to shelf: Quantum Mechanics"));
  fireEvent.press(screen.getByLabelText("Delete from library: Quantum Mechanics"));
  expect(onRead).toHaveBeenCalled();
  expect(onMove).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/ShelfBook.test.tsx`
Expected: FAIL — cannot find module `@/components/ShelfBook`.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/components/ShelfBook.tsx`:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BookCover } from "@/components/BookCover";
import { ExportStatusPills } from "@/components/ExportStatusPills";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { BookExportStatus } from "@/storage/exportStatus";
import { colors, radius, spacing, typography } from "@/constants/theme";

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

export function ShelfBook({
  meta,
  expanded,
  reviewCount,
  exportStatus,
  onPressSpine,
  onRead,
  onReviews,
  onMove,
  onDetails,
  onDelete,
}: {
  meta: EpubMeta;
  expanded: boolean;
  reviewCount?: number;
  exportStatus?: BookExportStatus;
  onPressSpine: () => void;
  onRead: () => void;
  onReviews: () => void;
  onMove: () => void;
  onDetails: () => void;
  onDelete: () => void;
}): JSX.Element {
  if (!expanded) {
    const s = spineStyleFor(meta.id);
    return (
      <Pressable
        onPress={onPressSpine}
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

  return (
    <View style={styles.pulled}>
      <Pressable onPress={onPressSpine} accessibilityRole="button" accessibilityLabel={`Close: ${meta.title}`}>
        <BookCover title={meta.title} coverUri={meta.coverUri} coverSvg={meta.coverSvg} />
      </Pressable>
      <ExportStatusPills status={exportStatus} />
      <Text style={styles.pulledTitle} numberOfLines={2}>
        {meta.title}
      </Text>
      <View style={styles.actions}>
        <Pressable onPress={onRead} accessibilityRole="button" accessibilityLabel={`Read: ${meta.title}`} style={styles.readBtn}>
          <Text style={styles.readText}>Read</Text>
        </Pressable>
        <Pressable onPress={onReviews} accessibilityRole="button" accessibilityLabel={`Reviews: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textSecondary} />
          {reviewCount ? <Text style={styles.count}>{reviewCount}</Text> : null}
        </Pressable>
        <Pressable onPress={onMove} accessibilityRole="button" accessibilityLabel={`Move to shelf: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="folder-outline" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={onDetails} accessibilityRole="button" accessibilityLabel={`Details: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete from library: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  spine: {
    width: 30,
    borderRadius: 3,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.sm,
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
  pulled: { width: 120, gap: spacing.xs, alignItems: "center" },
  pulledTitle: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.text, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  readBtn: { backgroundColor: colors.brand, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 10 },
  readText: { color: colors.brandText, fontWeight: "700", fontSize: typography.sizeXs },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  count: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.textSecondary },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/ShelfBook.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/ShelfBook.tsx mobile/__tests__/components/ShelfBook.test.tsx
git commit -m "feat(library): ShelfBook — spine + pulled-out cover/actions"
```

---

### Task 4: `ShelfBand` — one shelf: header, plank, horizontal spine rack

**Files:**
- Create: `mobile/src/components/ShelfBand.tsx`
- Test: `mobile/__tests__/components/ShelfBand.test.tsx`

**Interfaces:**
- Consumes: `Shelf` (Task 1), `ShelfSection` (Task 2), `ShelfBook` (Task 3), `EpubMeta`, `BookExportStatus`, `Ionicons`, theme.
- Produces:
  ```ts
  export function ShelfBand(props: {
    shelf: Shelf | null;                 // null → "Unshelved" band (no rename/delete)
    books: EpubMeta[];
    expandedId: string | null;
    counts: Record<string, number>;
    exportStatus: Record<string, BookExportStatus>;
    onExpand: (bookId: string | null) => void;
    onRead: (m: EpubMeta) => void;
    onReviews: (m: EpubMeta) => void;
    onMove: (m: EpubMeta) => void;
    onDetails: (m: EpubMeta) => void;
    onDelete: (m: EpubMeta) => void;
    onRename: () => void;                // real shelves only
    onDeleteShelf: () => void;           // real shelves only
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/ShelfBand.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBand } from "@/components/ShelfBand";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";

const shelf: Shelf = { id: "s1", name: "Physics", createdAt: "2026-07-04T00:00:00Z", order: 0 };
const book = (id: string): EpubMeta => ({ id, title: id, sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" });

const handlers = {
  onExpand: jest.fn(),
  onRead: jest.fn(),
  onReviews: jest.fn(),
  onMove: jest.fn(),
  onDetails: jest.fn(),
  onDelete: jest.fn(),
  onRename: jest.fn(),
  onDeleteShelf: jest.fn(),
};

function renderBand(overrides: Partial<React.ComponentProps<typeof ShelfBand>> = {}) {
  return render(
    <ShelfBand
      shelf={shelf}
      books={[book("b1")]}
      expandedId={null}
      counts={{}}
      exportStatus={{}}
      {...handlers}
      {...overrides}
    />,
  );
}

beforeEach(() => Object.values(handlers).forEach((h) => h.mockClear()));

it("renders the shelf name and its books", () => {
  renderBand();
  expect(screen.getByText("Physics")).toBeTruthy();
  expect(screen.getByLabelText("Open: b1")).toBeTruthy();
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/ShelfBand.test.tsx`
Expected: FAIL — cannot find module `@/components/ShelfBand`.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/components/ShelfBand.tsx`:

```tsx
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ShelfBook } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { BookExportStatus } from "@/storage/exportStatus";
import type { Shelf } from "@/storage/shelfStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

export function ShelfBand({
  shelf,
  books,
  expandedId,
  counts,
  exportStatus,
  onExpand,
  onRead,
  onReviews,
  onMove,
  onDetails,
  onDelete,
  onRename,
  onDeleteShelf,
}: {
  shelf: Shelf | null;
  books: EpubMeta[];
  expandedId: string | null;
  counts: Record<string, number>;
  exportStatus: Record<string, BookExportStatus>;
  onExpand: (bookId: string | null) => void;
  onRead: (m: EpubMeta) => void;
  onReviews: (m: EpubMeta) => void;
  onMove: (m: EpubMeta) => void;
  onDetails: (m: EpubMeta) => void;
  onDelete: (m: EpubMeta) => void;
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
            <ShelfBook
              key={m.id}
              meta={m}
              expanded={expandedId === m.id}
              reviewCount={counts[m.id]}
              exportStatus={exportStatus[m.id]}
              onPressSpine={() => onExpand(expandedId === m.id ? null : m.id)}
              onRead={() => onRead(m)}
              onReviews={() => onReviews(m)}
              onMove={() => onMove(m)}
              onDetails={() => onDetails(m)}
              onDelete={() => onDelete(m)}
            />
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/ShelfBand.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/ShelfBand.tsx mobile/__tests__/components/ShelfBand.test.tsx
git commit -m "feat(library): ShelfBand — shelf header, plank, horizontal rack"
```

---

### Task 5: `ShelfNameModal` — create / rename text input

**Files:**
- Create: `mobile/src/components/ShelfNameModal.tsx`
- Test: `mobile/__tests__/components/ShelfNameModal.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `TextInput`, theme.
- Produces:
  ```ts
  export function ShelfNameModal(props: {
    visible: boolean;
    title: string;            // e.g. "New shelf" / "Rename shelf"
    initialName?: string;
    onSubmit: (name: string) => void; // called with the trimmed name; parent closes
    onClose: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/ShelfNameModal.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfNameModal } from "@/components/ShelfNameModal";

it("submits the trimmed name and does not submit when empty", () => {
  const onSubmit = jest.fn();
  const onClose = jest.fn();
  render(<ShelfNameModal visible title="New shelf" onSubmit={onSubmit} onClose={onClose} />);

  // Empty → Save is a no-op.
  fireEvent.press(screen.getByLabelText("Save shelf name"));
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText("Shelf name"), "  Physics  ");
  fireEvent.press(screen.getByLabelText("Save shelf name"));
  expect(onSubmit).toHaveBeenCalledWith("Physics");
});

it("prefills initialName for rename", () => {
  render(<ShelfNameModal visible title="Rename shelf" initialName="Chem" onSubmit={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByDisplayValue("Chem")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/ShelfNameModal.test.tsx`
Expected: FAIL — cannot find module `@/components/ShelfNameModal`.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/components/ShelfNameModal.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

export function ShelfNameModal({
  visible,
  title,
  initialName,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialName?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName ?? "");

  // Reset the field each time the modal (re)opens.
  useEffect(() => {
    if (visible) setName(initialName ?? "");
  }, [visible, initialName]);

  const submit = () => {
    const clean = name.trim();
    if (!clean) return; // Save is a no-op on empty
    onSubmit(clean);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Shelf name"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Shelf name"
            style={styles.input}
            autoFocus
            onSubmitEditing={submit}
          />
          <View style={styles.row}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.btn}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Save shelf name" style={[styles.btn, styles.save]}>
              <Text style={[styles.btnText, styles.saveText]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
    fontSize: typography.sizeMd,
  },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnText: { fontWeight: "700", color: colors.textSecondary, fontSize: typography.sizeMd },
  save: { backgroundColor: colors.primary },
  saveText: { color: colors.primaryText },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/ShelfNameModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/ShelfNameModal.tsx mobile/__tests__/components/ShelfNameModal.test.tsx
git commit -m "feat(library): ShelfNameModal — create/rename shelf input"
```

---

### Task 6: `MoveToShelfModal` — the picker

**Files:**
- Create: `mobile/src/components/MoveToShelfModal.tsx`
- Test: `mobile/__tests__/components/MoveToShelfModal.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `Shelf` (Task 1), `Ionicons`, theme.
- Produces:
  ```ts
  export function MoveToShelfModal(props: {
    visible: boolean;
    shelves: Shelf[];
    currentShelfId: string | null;                 // the book's current shelf (radio-marked)
    onAssign: (shelfId: string | null) => void;     // pick a shelf, or null to remove
    onCreateShelf: () => void;                       // parent opens ShelfNameModal, then assigns
    onClose: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/MoveToShelfModal.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MoveToShelfModal } from "@/components/MoveToShelfModal";
import type { Shelf } from "@/storage/shelfStore";

const shelves: Shelf[] = [
  { id: "s1", name: "Physics", createdAt: "", order: 0 },
  { id: "s2", name: "Chemistry", createdAt: "", order: 1 },
];

function renderModal(overrides = {}) {
  const props = {
    visible: true,
    shelves,
    currentShelfId: "s2" as string | null,
    onAssign: jest.fn(),
    onCreateShelf: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<MoveToShelfModal {...props} />) };
}

it("assigns the picked shelf", () => {
  const { props } = renderModal();
  fireEvent.press(screen.getByLabelText("Move to shelf: Physics"));
  expect(props.onAssign).toHaveBeenCalledWith("s1");
});

it("removes from shelf", () => {
  const { props } = renderModal();
  fireEvent.press(screen.getByLabelText("Remove from shelf"));
  expect(props.onAssign).toHaveBeenCalledWith(null);
});

it("triggers new-shelf creation", () => {
  const { props } = renderModal();
  fireEvent.press(screen.getByLabelText("New shelf"));
  expect(props.onCreateShelf).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/MoveToShelfModal.test.tsx`
Expected: FAIL — cannot find module `@/components/MoveToShelfModal`.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/components/MoveToShelfModal.tsx`:

```tsx
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Shelf } from "@/storage/shelfStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

export function MoveToShelfModal({
  visible,
  shelves,
  currentShelfId,
  onAssign,
  onCreateShelf,
  onClose,
}: {
  visible: boolean;
  shelves: Shelf[];
  currentShelfId: string | null;
  onAssign: (shelfId: string | null) => void;
  onCreateShelf: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Move to shelf</Text>
          <ScrollView style={styles.list}>
            {shelves.map((s) => {
              const active = s.id === currentShelfId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => onAssign(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Move to shelf: ${s.name}`}
                  style={styles.rowItem}
                >
                  <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.primary : colors.textMuted} />
                  <Text style={styles.rowText}>{s.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={onCreateShelf} accessibilityRole="button" accessibilityLabel="New shelf" style={styles.rowItem}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={[styles.rowText, { color: colors.primary }]}>New shelf…</Text>
          </Pressable>

          <Pressable onPress={() => onAssign(null)} accessibilityRole="button" accessibilityLabel="Remove from shelf" style={styles.rowItem}>
            <Ionicons name="remove-circle-outline" size={20} color={colors.textMuted} />
            <Text style={styles.rowText}>Remove from shelf</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, maxHeight: "70%" },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  rowItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowText: { fontSize: typography.sizeMd, color: colors.text },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/MoveToShelfModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/MoveToShelfModal.tsx mobile/__tests__/components/MoveToShelfModal.test.tsx
git commit -m "feat(library): MoveToShelfModal — shelf picker"
```

---

### Task 7: Wire shelves into the Library page

**Files:**
- Modify: `mobile/app/(tabs)/library.tsx` (the `EpubLibrary` component + `styles`; `DemoLibrary` and `LibraryScreen` unchanged)

**Interfaces:**
- Consumes: everything from Tasks 1–6 — `listShelves`, `getAssignments`, `assignBook`, `createShelf`, `renameShelf`, `deleteShelf`, `pruneBook`, `Shelf` (`@/storage/shelfStore`); `groupIntoShelves` (`@/lib/groupShelves`); `ShelfBand`; `MoveToShelfModal`; `ShelfNameModal`. Reuses existing `Alert` (`@/lib/alert`), `BookMetadataModal`, and the existing handlers `openItem` / `openReviews` / `openMeta`.

- [ ] **Step 1: Replace the `EpubLibrary` grid with shelf bands and wire the shelf state**

In `mobile/app/(tabs)/library.tsx`, add the new imports near the existing ones (after line 24):

```tsx
import { ShelfBand } from "@/components/ShelfBand";
import { MoveToShelfModal } from "@/components/MoveToShelfModal";
import { ShelfNameModal } from "@/components/ShelfNameModal";
import { groupIntoShelves } from "@/lib/groupShelves";
import {
  assignBook,
  createShelf,
  deleteShelf,
  getAssignments,
  listShelves,
  pruneBook,
  renameShelf,
  type Shelf,
} from "@/storage/shelfStore";
```

Inside `EpubLibrary`, add shelf state alongside the existing `useState` hooks (after the `numColumns` line ~134):

```tsx
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The book whose move-to-shelf picker is open (null = closed).
  const [moveTarget, setMoveTarget] = useState<EpubMeta | null>(null);
  // The shelf-name modal: create, or rename an existing shelf.
  const [nameModal, setNameModal] = useState<{ mode: "create" | "rename"; shelf?: Shelf } | null>(null);
  // When a shelf is created from the picker, assign this book to it once made.
  const [pendingAssignBookId, setPendingAssignBookId] = useState<string | null>(null);
```

Add a shelf reload helper and fold it into the focus effect. Replace the existing `reload` (lines 136-150) so it also refreshes shelves + assignments:

```tsx
  const reloadShelves = useCallback(async () => {
    setShelves(await listShelves());
    setAssignments(await getAssignments());
  }, []);

  const reload = useCallback(() => {
    void reloadShelves();
    listEpubs()
      .then(async (list) => {
        setItems(list);
        await Promise.all(list.map((m) => maybeSeedReviews(m.id)));
        setCounts(await reviewCounts(list.map((m) => m.id)));
        setPublished(await loadPublishedMap(list.map((m) => m.id)));
      })
      .catch(() => {
        setItems([]);
        setCounts({});
      });
  }, [reloadShelves]);
```

Update `handleDelete` (lines 162-165) to prune the deleted book's shelf assignment:

```tsx
  const handleDelete = useCallback(async (id: string) => {
    await deleteEpub(id);
    await pruneBook(id);
    setItems((prev) => prev.filter((m) => m.id !== id));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
```

- [ ] **Step 2: Add the shelf action handlers and the New-shelf header button**

Inside `EpubLibrary`, after `openReviews` (~line 248), add:

```tsx
  const currentShelfId = moveTarget ? assignments[moveTarget.id] ?? null : null;

  const handleAssign = useCallback(
    async (shelfId: string | null) => {
      if (!moveTarget) return;
      await assignBook(moveTarget.id, shelfId);
      setMoveTarget(null);
      await reloadShelves();
    },
    [moveTarget, reloadShelves],
  );

  const handleNameSubmit = useCallback(
    async (name: string) => {
      if (nameModal?.mode === "rename" && nameModal.shelf) {
        await renameShelf(nameModal.shelf.id, name);
      } else {
        const shelf = await createShelf(name);
        if (pendingAssignBookId) await assignBook(pendingAssignBookId, shelf.id);
      }
      setNameModal(null);
      setPendingAssignBookId(null);
      await reloadShelves();
    },
    [nameModal, pendingAssignBookId, reloadShelves],
  );

  const confirmDeleteShelf = useCallback(
    (shelf: Shelf) => {
      Alert.alert("Delete shelf?", `“${shelf.name}” will be removed. Its books move to Unshelved (books are not deleted).`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteShelf(shelf.id).then(reloadShelves);
          },
        },
      ]);
    },
    [reloadShelves],
  );

  const newShelfButton = (
    <Pressable
      style={styles.importBtn}
      onPress={() => {
        setPendingAssignBookId(null);
        setNameModal({ mode: "create" });
      }}
      accessibilityRole="button"
      accessibilityLabel="Create a new shelf"
    >
      <Ionicons name="add" size={16} color={colors.primary} />
      <Text style={styles.importBtnText}>New shelf</Text>
    </Pressable>
  );
```

- [ ] **Step 3: Swap the grid `FlatList` for a shelf-band list and add the modals**

Replace the `list` definition (lines 286-340) with a bands list built from `groupIntoShelves`:

```tsx
  const sections = groupIntoShelves(items, shelves, assignments);

  const list = (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.gridContent, isDesktop && styles.gridWide]}
      data={sections}
      keyExtractor={(sec) => sec.shelf?.id ?? "__unshelved__"}
      ListHeaderComponent={
        <View style={styles.header}>
          {importButton}
          {newShelfButton}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      }
      renderItem={({ item: sec }) => (
        <ShelfBand
          shelf={sec.shelf}
          books={sec.books}
          expandedId={expandedId}
          counts={counts}
          exportStatus={exportStatus}
          onExpand={setExpandedId}
          onRead={(m) => {
            setExpandedId(null);
            openItem(m);
          }}
          onReviews={openReviews}
          onMove={(m) => setMoveTarget(m)}
          onDetails={openMeta}
          onDelete={(m) => handleDelete(m.id)}
          onRename={() => sec.shelf && setNameModal({ mode: "rename", shelf: sec.shelf })}
          onDeleteShelf={() => sec.shelf && confirmDeleteShelf(sec.shelf)}
        />
      )}
    />
  );
```

Replace the component's `return (...)` (lines 342-357) so the two shelf modals render alongside the existing `BookMetadataModal`:

```tsx
  return (
    <>
      {list}
      <BookMetadataModal
        visible={!!selected}
        book={selectedBook}
        meta={selected ? { title: selected.title, compiledAt: selected.compiledAt } : null}
        loading={loadingBook}
        onRead={() => {
          const item = selected;
          closeMeta();
          if (item) openItem(item);
        }}
        onClose={closeMeta}
      />
      <MoveToShelfModal
        visible={!!moveTarget}
        shelves={shelves}
        currentShelfId={currentShelfId}
        onAssign={handleAssign}
        onCreateShelf={() => {
          if (moveTarget) setPendingAssignBookId(moveTarget.id);
          setMoveTarget(null);
          setNameModal({ mode: "create" });
        }}
        onClose={() => setMoveTarget(null)}
      />
      <ShelfNameModal
        visible={!!nameModal}
        title={nameModal?.mode === "rename" ? "Rename shelf" : "New shelf"}
        initialName={nameModal?.shelf?.name}
        onSubmit={handleNameSubmit}
        onClose={() => {
          setNameModal(null);
          setPendingAssignBookId(null);
        }}
      />
    </>
  );
```

Delete the now-unused grid pieces: the `numColumns` constant (line 134) and the `styles.tile*` / `styles.gridRow` / `styles.reviewsChip` / `styles.reviewsCount` entries that only the old grid used (leave `list`, `gridContent`, `gridWide`, `header`, `importBtn*`, `errorText`, `empty*`, `cta*`). Also remove the `formatSize`/`formatDate` calls' only remaining users if they become unused — check with the typecheck in Step 4 and delete any function the compiler flags as unused.

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: no errors. (Fix any unused-symbol errors by deleting the dead grid helpers/styles flagged.)

Run: `npx jest`
Expected: PASS — all new tests plus the existing suite green.

- [ ] **Step 5: Manually verify the interaction in the running app**

Use the `verify` skill / `run` skill to launch the app (web preview is fastest: `npx expo start` → open the Library tab with ≥2 saved books). Confirm:
1. Books appear as spines on a wood plank under an "Unshelved" band.
2. **New shelf** → name it → empty band appears with the hint.
3. Tap a spine → it pulls out showing cover + Read/reviews/move/details/delete.
4. Move (folder) → pick the new shelf → book moves to that band; Unshelved updates.
5. Rename (✎) and Delete (🗑) the shelf → on delete, its book returns to Unshelved (book not deleted).
6. Reload the page → shelves + assignments persist.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(tabs\)/library.tsx
git commit -m "feat(library): render books on shelves with move/rename/delete"
```

---

## Self-Review

**Spec coverage:**
- Data model (two AsyncStorage keys, `bookId→shelfId`, one-shelf invariant) → Task 1. ✔
- API `listShelves/createShelf/renameShelf/deleteShelf/assignBook/getAssignments/pruneBook` → Task 1. ✔
- `groupIntoShelves` (empty shelves, Unshelved with stale-pointer catch, per-section order, omit-empty-Unshelved) → Task 2. ✔
- Spine render + deterministic color/height + pull-out cover/actions → Task 3. ✔ (⋯ menu refined to a flat action row for `@/lib/alert` web-shim safety — noted in Task 3.)
- Shelf band: header + ✎, warm-wood plank, horizontal rack, empty hint → Task 4. ✔
- Create/rename input modal (Android-safe, not `Alert.prompt`) → Task 5. ✔
- Move-to-shelf picker (radio current, New shelf…, Remove) → Task 6. ✔
- Library integration: load shelves+assignments on focus, header New-shelf button, delete prunes, demo untouched, shelf order = creation, horizontal rack overflow → Task 7. ✔
- Delete-shelf → books unshelved via `Alert` confirm → Task 7 `confirmDeleteShelf`. ✔

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test shows real assertions. ✔

**Type consistency:** `Shelf`, `ShelfSection`, `EpubMeta`, `BookExportStatus` used identically across tasks; `assignBook(bookId, shelfId|null)`, `onExpand(bookId|null)`, `groupIntoShelves(items, shelves, assignments)` signatures match between producer and consumer tasks; `spineStyleFor` exported from Task 3 is imported only by its own test. ✔
