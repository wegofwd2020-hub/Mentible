import type { Book, ImportedChapter, StructuredTOC, TopicNode } from "@/types/book";
import type { ParsedEpub } from "@/openshelves/epubReader";
import { chapterImageMap } from "@/openshelves/epubImages";

// ParsedEpub → Book. Pure, no I/O, DOM-free (Hermes has no DOM) — the easiest
// unit to test hard.
//
// The spine maps onto the EXISTING StructuredTOC, so the Library, the book
// list, the TOC drawer and progress all work unchanged. That is the whole
// reason this mapping is worth having.
//
// Chapter HTML is stored RAW and untouched — no rewriting happens here.
// Rewriting HTML at import proved unsafe (see epubImages.ts's history: a
// decoy `data-src`, a duplicate `src`, `srcset`, and a quote-blind tag
// splitter each let a remote tracking URL survive regex rewriting). The fix
// is architectural: only a real parsed DOM at the render boundary (Task 6)
// may sanitize and swap references, using each chapter's `images` map here.

export function epubToBook(parsed: ParsedEpub, opts: { id: string; now: string }): Book {
  const units: TopicNode[] = [];
  const chapters: Record<string, ImportedChapter> = {};

  parsed.spine.forEach((item, i) => {
    const chapterId = `${opts.id}-ch${i + 1}`;
    units.push({ id: chapterId, title: item.title, subtopics: [], prerequisites: [] });
    chapters[chapterId] = {
      chapterId,
      title: item.title,
      html: item.html,
      images: chapterImageMap(item.images),
      importedAt: opts.now,
    };
  });

  const toc: StructuredTOC = {
    subjects: [{ subject_label: parsed.metadata.title, units }],
  };

  return {
    id: opts.id,
    title: parsed.metadata.title,
    toc,
    createdAt: opts.now,
    updatedAt: opts.now,
    source: "imported",
    chapters,
    metadata: {
      author: parsed.metadata.authors.join(", ") || undefined,
      language: parsed.metadata.language,
    },
  };
}
