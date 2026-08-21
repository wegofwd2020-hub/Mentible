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
// Bumped by every mutating fn below (createShelf/renameShelf/deleteShelf/
// assignBook) — the client sync engine's `syncShelves` (ADR-014 increment 2)
// uses this as the single doc's LWW clock, the same role `Book.updatedAt`
// plays for books. Plain AsyncStorage is fine — not a secret, just a clock.
const UPDATED_AT_KEY = "sbq_shelves_updated_at";
// Default when the key has never been written (no shelves mutation has ever
// happened on this device) — sorts as "older than anything real" so a fresh
// device never wins a LWW race against a peer that has actually synced.
const EPOCH = new Date(0).toISOString();

export interface Shelf {
  id: string;
  name: string;
  createdAt: string; // ISO
  order: number; // ascending; new shelves get max(order)+1
}

type Assignments = Record<string, string>; // bookId → shelfId

// In-memory change notification (pub/sub) for local shelf edits — mirrors
// `subscribeBookStore` (bookStore.ts). Consumed by `autoSync`'s edit trigger
// so creating/renaming/deleting a shelf or (re)assigning a book eventually
// pushes, same as an edited book does.
const _listeners = new Set<() => void>();

export function subscribeShelfStore(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _emit(): void {
  for (const l of _listeners) {
    try {
      l();
    } catch {
      // A listener must not break a shelf mutation.
    }
  }
}

// Bump the doc clock + notify — called at the end of every mutating fn.
async function _touch(): Promise<void> {
  await AsyncStorage.setItem(UPDATED_AT_KEY, new Date().toISOString());
  _emit();
}

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
  await _touch();
  return shelf;
}

export async function renameShelf(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("Shelf name cannot be empty.");
  const shelves = await readShelves();
  await writeShelves(shelves.map((s) => (s.id === id ? { ...s, name: clean } : s)));
  await _touch();
}

export async function deleteShelf(id: string): Promise<void> {
  await writeShelves((await readShelves()).filter((s) => s.id !== id));
  const assignments = await readAssignments();
  for (const [bookId, shelfId] of Object.entries(assignments)) {
    if (shelfId === id) delete assignments[bookId];
  }
  await writeAssignments(assignments);
  await _touch();
}

export async function getAssignments(): Promise<Assignments> {
  return readAssignments();
}

export async function assignBook(bookId: string, shelfId: string | null): Promise<void> {
  const assignments = await readAssignments();
  if (shelfId === null) delete assignments[bookId];
  else assignments[bookId] = shelfId;
  await writeAssignments(assignments);
  await _touch();
}

export async function pruneBook(bookId: string): Promise<void> {
  return assignBook(bookId, null);
}

// ── Sync doc (ADR-014 increment 2) ──────────────────────────────────────────
// The whole shelves+assignments state as a single document, synced (LWW) as
// one blob by `syncEngine.syncShelves` — mirrors how a `Book` is one document
// for `syncNow`. `updatedAt` is this device's doc clock (see `UPDATED_AT_KEY`
// above); a device that has never mutated shelves reports `EPOCH`, so it never
// wins a LWW race against a peer that actually has data.
export interface ShelvesDoc {
  shelves: Shelf[];
  assignments: Assignments;
  updatedAt: string;
}

export async function exportShelvesDoc(): Promise<ShelvesDoc> {
  const [shelves, assignments, updatedAt] = await Promise.all([
    readShelves(),
    readAssignments(),
    AsyncStorage.getItem(UPDATED_AT_KEY),
  ]);
  return { shelves, assignments, updatedAt: updatedAt ?? EPOCH };
}

// Overwrites all three keys with a pulled/decrypted doc from the sync engine.
// Deliberately does NOT call `_touch()` — the imported `updatedAt` (the
// server's `client_version`) IS the doc clock now; bumping it to "now" here
// would make this device look newer than the peer it just pulled from and
// cause it to spuriously re-push on the very next sync. It DOES still `_emit()`
// so any mounted shelf UI reflects the pulled state immediately.
export async function importShelvesDoc(doc: ShelvesDoc): Promise<void> {
  await writeShelves(doc.shelves);
  await writeAssignments(doc.assignments);
  await AsyncStorage.setItem(UPDATED_AT_KEY, doc.updatedAt);
  _emit();
}
