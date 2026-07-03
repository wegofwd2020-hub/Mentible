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
  // Carry through bibliographic metadata and the generation template verbatim:
  // these drive the compiled artifact (the cover's byline + edition stamp, the
  // colophon, copyright, glossary, OPF dc:* fields). Dropping them on import is
  // why a JSON round-trip "lost" the designed cover — it regenerated without the
  // author and edition. Passed through whole so fields the mobile type doesn't
  // model yet (the compiler is the authority) still survive to /export.
  const metadata = isRecord(data.metadata) ? (data.metadata as Book["metadata"]) : undefined;
  if (metadata && "tags" in metadata) {
    // Normalise imported tags to a clean string[] (or drop the field). Other
    // metadata still flows through verbatim (the compiler is the authority).
    metadata.tags = Array.isArray(metadata.tags)
      ? metadata.tags.filter((t): t is string => typeof t === "string")
      : undefined;
  }
  const generationParams = isRecord(data.generationParams)
    ? (data.generationParams as unknown as Book["generationParams"])
    : undefined;

  return {
    id,
    title,
    toc: ensureTopicIds(toc as unknown as StructuredTOC),
    createdAt,
    updatedAt: now,
    content,
    ...(generationParams ? { generationParams } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/** Parse, validate, and persist a book. Returns the stored Book. */
export async function importBook(raw: string): Promise<Book> {
  const book = parseBook(raw);
  await saveBook(book);
  return book;
}
