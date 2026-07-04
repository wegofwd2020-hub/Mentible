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
