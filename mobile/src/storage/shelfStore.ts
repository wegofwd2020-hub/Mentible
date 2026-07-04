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
