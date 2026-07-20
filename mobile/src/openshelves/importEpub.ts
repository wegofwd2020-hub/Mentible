import type { Book } from "@/types/book";
import { readEpub } from "@/openshelves/epubReader";
import { epubToBook } from "@/openshelves/epubToBook";
import { EpubError } from "@/storage/epubZip";
import { saveBook } from "@/storage/bookStore";
import { randomUUID } from "@/lib/uuid";

// Read → map → persist. The one slow step of F1.
//
// ATOMIC by construction: everything before `saveBook` is pure and in-memory, so
// a malformed or hostile EPUB fails loudly here and persists NOTHING. Same
// discipline as addSource — validate and parse fully before touching the store.

export const MAX_EPUB_BYTES = 50 * 1024 * 1024;

export async function importEpub(bytes: Uint8Array): Promise<Book> {
  if (bytes.byteLength > MAX_EPUB_BYTES) {
    throw new EpubError("That EPUB is too large to open (max 50 MB).");
  }
  const parsed = readEpub(bytes); // throws EpubError; nothing persisted yet
  const book = epubToBook(parsed, { id: randomUUID(), now: new Date().toISOString() });
  await saveBook(book);
  return book;
}
