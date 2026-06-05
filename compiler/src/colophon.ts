import { escapeHtml } from "./html";
import { editionLabel, isDraft } from "./release";
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
  // Release lifecycle (ADR-008): a draft notice, or the edition/version + date.
  const edition = editionLabel(m);
  if (isDraft(m)) {
    p.push(`<p class="draft-notice">${escapeHtml(edition || "DRAFT")} — not for distribution</p>`);
  } else if (edition) {
    p.push(`<p class="edition">${escapeHtml(edition)}</p>`);
  }
  const pubDate = m.releaseDate || m.date;
  if (pubDate) p.push(`<p class="pubdate">${escapeHtml(pubDate)}</p>`);
  p.push("<hr/>");
  p.push(`<p class="rights">${escapeHtml(rights)}</p>`);
  p.push(`<p class="identifier">${escapeHtml(m.identifier || book.id)}</p>`);
  if (m.revisionHistory && m.revisionHistory.length) {
    const rows = m.revisionHistory
      .map(
        (r) =>
          `<li>v${escapeHtml(r.version)} — ${escapeHtml(r.date)}${r.notes ? ` · ${escapeHtml(r.notes)}` : ""}</li>`,
      )
      .join("");
    p.push(`<div class="revisions"><h2>Revision history</h2><ul>${rows}</ul></div>`);
  }
  p.push(`<p class="colophon-note">Compiled with Mentible.</p>`);
  return `<section epub:type="copyright-page" class="colophon">\n${p.join("\n")}\n</section>`;
}
