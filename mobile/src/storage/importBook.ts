import type { Book, StructuredTOC } from "@/types/book";
import { ensureTopicIds, saveBook } from "@/storage/bookStore";
import { randomUUID } from "@/lib/uuid";

// Ingest a book produced elsewhere — chiefly a migrated book.json exported from
// the OnDemand Authoring Studio (StudyBuddy_OnDemand book_export.py), which
// already matches the local Book shape (TOC keyed to per-topic content by id).
// Validation is deliberately structural-only: the content bodies are trusted
// (they came from our own export) and the renderer tolerates missing fields.

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse + structurally validate a book JSON string into a normalized Book. */
export function parseBook(raw: string): Book {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ImportError("That doesn’t look like valid JSON.");
  }
  if (!isRecord(data)) {
    throw new ImportError("Expected a book object at the top level.");
  }

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) {
    throw new ImportError("This book is missing a title.");
  }

  const toc = data.toc;
  if (!isRecord(toc) || !Array.isArray(toc.subjects)) {
    throw new ImportError("This book is missing a table of contents (toc.subjects).");
  }

  const now = new Date().toISOString();
  const id = typeof data.id === "string" && data.id ? data.id : randomUUID();
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : now;
  const content = isRecord(data.content) ? (data.content as Book["content"]) : undefined;

  return {
    id,
    title,
    toc: ensureTopicIds(toc as unknown as StructuredTOC),
    createdAt,
    updatedAt: now,
    content,
  };
}

/** Parse, validate, and persist a book. Returns the stored Book. */
export async function importBook(raw: string): Promise<Book> {
  const book = parseBook(raw);
  await saveBook(book);
  return book;
}
