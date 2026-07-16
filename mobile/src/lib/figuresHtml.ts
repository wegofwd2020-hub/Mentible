import type { Book, TopicImage } from "@/types/book";

/**
 * How many figures a book carries in total, counted from the schema refs alone.
 *
 * Needs no bytes on disk — `book.content[*].images[]` are refs (media slice 1),
 * so this answers "does this book have figures?" for a book that arrived over
 * the wire with no media. That is exactly the shared-draft case (#320): the
 * author is warned their figures won't travel, and the reviewer is told some
 * exist, both from `book_json` alone.
 */
export function countBookFigures(book: Book): number {
  return Object.values(book?.content ?? {}).reduce((n, gen) => n + (gen?.images?.length ?? 0), 0);
}

// Self-contained HTML escaper (this module is imported by both the web reader and
// the WebView builder; keep it dependency-free).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A "Figures" section for a topic's attached images. Only images whose id has a
 * resolved data: URL are rendered. `src` is ALWAYS a caller-provided data: URL
 * (never remote) — the local-only invariant.
 */
export function renderFiguresHtml(images: TopicImage[], dataUrls: Map<string, string>): string {
  const figs = (images ?? [])
    .map((img) => {
      const src = dataUrls.get(img.id);
      if (!src) return "";
      const cap = img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : "";
      return `<figure class="attached-figure"><img src="${esc(src)}" alt="${esc(img.caption ?? "")}">${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
  if (!figs) return "";
  return `<hr class="section-divider"><section class="figures"><h3>Figures</h3>${figs}</section>`;
}
