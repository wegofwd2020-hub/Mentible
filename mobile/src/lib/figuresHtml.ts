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
 * The alt text for one figure — the SINGLE place alt is decided.
 *
 * Three surfaces render a figure (this module for the web reader, the mirrored
 * JS twin in `contentHtml.ts` for the WebView, and `compilePayload.ts` for the
 * compiled EPUB/PDF). They each used to inline their own expression and they
 * DISAGREED: the readers emitted `alt=""` while the compile payload emitted
 * `"Fig 1. "`. Everything now routes through here so they cannot drift again.
 *
 * **Never returns `""`.** An empty alt is HTML for "decorative — skip me", and a
 * figure an author attached to a lesson topic is meaningful by definition;
 * claiming otherwise silently hides it from screen readers. When the author has
 * given nothing, a positional label is weak but honest — it says something is
 * there and never lies about what.
 *
 * Precedence: explicit alt → caption → "Figure N". Blank/whitespace counts as
 * absent, so a stray space can't reintroduce a meaningless alt.
 */
export function figureAltText(img: TopicImage, index: number): string {
  return img.alt?.trim() || img.caption?.trim() || `Figure ${index + 1}`;
}

/**
 * A "Figures" section for a topic's attached images. Only images whose id has a
 * resolved data: URL are rendered. `src` is ALWAYS a caller-provided data: URL
 * (never remote) — the local-only invariant.
 */
export function renderFiguresHtml(images: TopicImage[], dataUrls: Map<string, string>): string {
  const figs = (images ?? [])
    .map((img, i) => {
      const src = dataUrls.get(img.id);
      if (!src) return "";
      const cap = img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : "";
      return `<figure class="attached-figure"><img src="${esc(src)}" alt="${esc(figureAltText(img, i))}">${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
  if (!figs) return "";
  return `<hr class="section-divider"><section class="figures"><h3>Figures</h3>${figs}</section>`;
}
