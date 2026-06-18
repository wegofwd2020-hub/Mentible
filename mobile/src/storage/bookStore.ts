import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Book, BookMeta, GeneratedTopic, StructuredTOC } from "@/types/book";
import { randomUUID } from "@/lib/uuid";
import { DEFAULT_GENERATION_PARAMS } from "@/types/generationParams";

// Local-first book storage (ADR-003 D1) — same AsyncStorage shape as the lesson
// library: a single index + one entry per book. Migrate to expo-sqlite if books
// outgrow AsyncStorage's quota (ADR-003 open question).
const INDEX_KEY = "sbq_book_index";
const bookKey = (id: string) => `sbq_book_${id}`;

function countUnits(toc: StructuredTOC): number {
  return toc.subjects.reduce((n, s) => n + s.units.length, 0);
}

// Ensure every topic (unit) has a stable id, assigning one where missing.
// Returns a new TOC; the input is not mutated. Used when a structured TOC first
// arrives and when loading older books saved before topic ids existed.
export function ensureTopicIds(toc: StructuredTOC): StructuredTOC {
  return {
    subjects: toc.subjects.map((s) => ({
      ...s,
      units: s.units.map((u) => (u.id ? u : { ...u, id: randomUUID() })),
    })),
  };
}

function topicIds(toc: StructuredTOC): Set<string> {
  const ids = new Set<string>();
  for (const s of toc.subjects) for (const u of s.units) if (u.id) ids.add(u.id);
  return ids;
}

// Whether a topic's stored content is actually renderable. A bare content *entry*
// is not enough: a partial/empty write (or a generation captured without a body)
// leaves an entry with no lesson body, which renders blank and — worse — used to
// make "Generate all" treat the topic as done and skip it. Require a real lesson:
// at least one section, or a synopsis. Single source of truth for "is this topic
// generated?" across the books list, the reader, and the gap-fill loop.
export function hasRenderableLesson(gen: GeneratedTopic | undefined | null): boolean {
  const lesson = gen?.lesson;
  if (!lesson) return false;
  return (lesson.sections?.length ?? 0) > 0 || Boolean(lesson.synopsis?.trim());
}

// The ids of topics whose stored content is renderable (the "done" set).
export function generatedTopicIds(book: Book): string[] {
  return Object.entries(book.content ?? {})
    .filter(([, gen]) => hasRenderableLesson(gen))
    .map(([id]) => id);
}

// Attach/replace one topic's generated content, returning a new Book. Bumps
// updatedAt so the index reflects the change.
export function setTopicContent(book: Book, gen: GeneratedTopic): Book {
  const prior = book.content?.[gen.topicId];
  // Monotonic per-unit regeneration count (ADR-016 D7 content version): bump on
  // every overwrite of existing content; a first generation keeps the caller's
  // value (normally absent ⇒ original). The pair (content version ↔ provenance)
  // stays consistent because the caller re-stamps provenance on the same gen.
  const revisionCount = prior ? (prior.revisionCount ?? 0) + 1 : gen.revisionCount;
  return {
    ...book,
    content: { ...(book.content ?? {}), [gen.topicId]: { ...gen, revisionCount } },
    updatedAt: new Date().toISOString(),
  };
}

function toMeta(book: Book): BookMeta {
  return {
    id: book.id,
    title: book.title,
    subjectCount: book.toc.subjects.length,
    unitCount: countUnits(book.toc),
    updatedAt: book.updatedAt,
    generatedCount: generatedTopicIds(book).length,
    ...(book.source ? { source: book.source } : {}),
    ...(book.metadata?.coverSvg ? { coverSvg: book.metadata.coverSvg } : {}),
  };
}

export async function saveBook(book: Book): Promise<void> {
  // Prune generated content for topics that no longer exist in the tree.
  const validIds = topicIds(book.toc);
  const pruned: Record<string, GeneratedTopic> = {};
  for (const [id, gen] of Object.entries(book.content ?? {})) {
    if (validIds.has(id)) pruned[id] = gen;
  }
  const toStore: Book = { ...book, content: pruned };

  await AsyncStorage.setItem(bookKey(book.id), JSON.stringify(toStore));

  const index = await loadBookIndex();
  const deduped = index.filter((m) => m.id !== book.id);
  await AsyncStorage.setItem(
    INDEX_KEY,
    JSON.stringify([toMeta(book), ...deduped]),
  );
}

export async function loadBookIndex(): Promise<BookMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as BookMeta[];
  } catch {
    return [];
  }
}

export async function loadBook(id: string): Promise<Book | null> {
  const raw = await AsyncStorage.getItem(bookKey(id));
  if (!raw) return null;
  try {
    const book = JSON.parse(raw) as Book;
    // Backfill topic ids for books saved before generate-all existed, and a
    // default generation template for books saved before templates existed.
    // Persisted on the next save; in-memory here so callers always see them.
    return {
      ...book,
      toc: ensureTopicIds(book.toc),
      generationParams: book.generationParams ?? { ...DEFAULT_GENERATION_PARAMS },
    };
  } catch {
    return null;
  }
}

export async function deleteBook(id: string): Promise<void> {
  const index = await loadBookIndex();
  await Promise.all([
    AsyncStorage.removeItem(bookKey(id)),
    AsyncStorage.setItem(
      INDEX_KEY,
      JSON.stringify(index.filter((m) => m.id !== id)),
    ),
  ]);
}
