import { escapeHtml } from "./html";
import type { Book } from "./types";

// The shared copyright / colophon page body (a single <section>), used by BOTH
// the EPUB (wrapped as its own content document) and the PDF (its own page),
// so the two artifacts stay in lock-step. Built from Book.metadata; falls back
// to "© <year> <holder>. All rights reserved." when rights aren't supplied.
// The `epub:type` attribute is meaningful in the EPUB and harmlessly ignored by
// the PDF (Vivliostyle) renderer.
export function colophonSection(book: Book): string {
  const m = book.metadata ?? {};
  const yearMatch = m.date ? /\d{4}/.exec(m.date) : null;
  const year =
    yearMatch?.[0] ??
    String(new Date(book.updatedAt || Date.now()).getUTCFullYear() || new Date().getUTCFullYear());
  const holder = m.author || m.publisher;
  const rights =
    m.rights ?? (holder ? `© ${year} ${holder}. All rights reserved.` : `© ${year}. All rights reserved.`);

  const p: string[] = [`<h1>${escapeHtml(book.title)}</h1>`];
  if (m.author) p.push(`<p class="byline">by ${escapeHtml(m.author)}</p>`);
  if (m.publisher) p.push(`<p class="publisher">${escapeHtml(m.publisher)}</p>`);
  if (m.date) p.push(`<p class="pubdate">${escapeHtml(m.date)}</p>`);
  p.push("<hr/>");
  p.push(`<p class="rights">${escapeHtml(rights)}</p>`);
  p.push(`<p class="identifier">${escapeHtml(m.identifier || book.id)}</p>`);
  p.push(`<p class="colophon-note">Compiled with Mentible.</p>`);
  return `<section epub:type="copyright-page" class="colophon">\n${p.join("\n")}\n</section>`;
}
