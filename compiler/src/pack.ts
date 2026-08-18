// Publish Pack (P2-6 Scope B, docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md):
// bundle everything an author needs to hand a book to a retailer into one zip
// — the KDP-clean EPUB, its raster cover, a human-readable metadata sheet, and
// a per-retailer upload checklist — so the manual upload is one download + a
// copy-paste, not a scavenger hunt. Still no retailer API (none exist); the
// author still uploads by hand.

import JSZip from "jszip";
import { compileEpub, isoDate } from "./epub";
import { buildCoverSvgRaster, coverInputForBook } from "./cover";
import { renderCoverJpeg } from "./coverRaster";
import { escapeHtml } from "./html";
import type { Book } from "./types";
import type { MermaidRenderer } from "./mermaid";

// D2: a human-readable sheet only — no ONIX, no CSV. Lists the fields we
// store, plus labeled blanks for the KDP fields we don't (subtitle, up to 7
// keywords, BISAC categories) so the author fills them into the retailer's
// form. Never invent keyword/category/subtitle values — they stay blank.
export function buildMetadataSheet(book: Book): string {
  const m = book.metadata ?? {};
  const author = m.author ?? "—";
  const authorFileAs = m.authorFileAs || m.author || "—";
  const language = m.language || "en";
  const date = m.date ? isoDate(m.date) : "—";
  const isbn = m.isbn ?? "—";
  const translator = m.translator ?? "—";
  const description = m.description ?? "—";
  return [
    `Title:        ${book.title}`,
    `Author:       ${author}            (Sort-as: ${authorFileAs})`,
    `Language:     ${language}       Publication date: ${date}`,
    `ISBN:         ${isbn}            Translator: ${translator}`,
    ``,
    `Description:`,
    description,
    ``,
    `— Fill these in on the retailer's form (Mentible doesn't store them yet) —`,
    `Subtitle:     ____________________`,
    `Keywords (up to 7):  ______ , ______ , ______ , ______ , ______ , ______ , ______`,
    `Categories (BISAC):  ____________________`,
    ``,
  ].join("\n");
}

// D3: KDP + Draft2Digital + PublishDrive are linked; Apple Books direct is
// NOTED (needs a Mac + Transporter — no web upload), not linked as a dead
// end; IngramSpark is omitted (print-first, paid). Escape every book-derived
// string — this HTML ships inside the zip and could be opened directly.
export function buildPublishReadme(book: Book): string {
  const title = escapeHtml(book.title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Publish pack — ${title}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:2rem auto;padding:0 1.5rem;color:#1a1a1a;line-height:1.5}
h1{font-size:1.4rem}
h2{font-size:1.1rem;margin-top:2rem}
code{background:#f0f0f0;padding:0 .25rem;border-radius:3px}
.note{background:#fff8e1;border-left:4px solid #d4a017;padding:.75rem 1rem;margin:1rem 0}
</style>
</head>
<body>
<h1>Publish pack — ${title}</h1>
<p>This zip contains everything you need to hand this book to a retailer:</p>
<ul>
<li><code>book.epub</code> — the KDP-clean EPUB (rasterized math/diagrams, JPEG cover)</li>
<li><code>cover.jpg</code> — the 1600&times;2560 ebook cover</li>
<li><code>metadata.txt</code> — a plain-text metadata sheet to copy into the retailer's form</li>
<li><code>README.html</code> — this file</li>
</ul>

<h2>Amazon KDP</h2>
<ol>
<li>Go to <a href="https://kdp.amazon.com">kdp.amazon.com</a> &rarr; Bookshelf &rarr; + Create &rarr; New Kindle eBook.</li>
<li>Upload <code>book.epub</code> as the manuscript.</li>
<li>Upload <code>cover.jpg</code> as the cover.</li>
<li>Copy the fields from <code>metadata.txt</code> into KDP's title/author/description/keywords/category form.</li>
</ol>

<h2>Draft2Digital</h2>
<p>Go to <a href="https://draft2digital.com">draft2digital.com</a> and upload the same <code>book.epub</code> + <code>cover.jpg</code> once — Draft2Digital fans that single upload out to Apple Books, Kobo, Barnes &amp; Noble, and more.</p>

<h2>PublishDrive</h2>
<p>Go to <a href="https://www.publishdrive.com">publishdrive.com</a>, another aggregator covering additional storefronts and libraries.</p>

<div class="note">Apple Books direct requires a Mac (Transporter) — no web upload. Use Draft2Digital above to reach Apple Books without one.</div>
</body>
</html>
`;
}

// D1: exactly `book.epub`, `cover.jpg`, `metadata.txt`, `README.html`.
// book.epub reuses compileEpub's own kdp-profile cover raster internally;
// this standalone cover.jpg is a second, independent raster of the same
// input so the pack carries its cover as a plain file a retailer form can
// upload directly (no unzip-the-EPUB step). Calling compileEpub FIRST means
// a draft book's KdpDraftError surfaces before any further Chromium work.
//
// `opts.mermaid` threads through to compileEpub so the pack's book.epub
// rasterizes Mermaid diagrams (kdp profile => <img>) instead of dropping them
// as placeholders — the pack's own README.html claims "rasterized
// math/diagrams", so this option must actually reach the diagram renderer.
export async function compilePack(book: Book, opts: { mermaid?: MermaidRenderer } = {}): Promise<Buffer> {
  const epubBytes = await compileEpub(book, { ...opts, profile: "kdp" });
  const coverJpeg = await renderCoverJpeg(buildCoverSvgRaster(coverInputForBook(book)));

  const zip = new JSZip();
  zip.file("book.epub", epubBytes);
  zip.file("cover.jpg", coverJpeg);
  zip.file("metadata.txt", buildMetadataSheet(book));
  zip.file("README.html", buildPublishReadme(book));
  return zip.generateAsync({ type: "nodebuffer" });
}
