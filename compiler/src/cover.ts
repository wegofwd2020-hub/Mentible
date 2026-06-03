import { escapeHtml } from "./html";
import { BRAND } from "./tokens";
import type { Book } from "./types";

// Generates the book's cover — the "Editorial" design: a deep indigo upper field
// with a green check-into-arrow mark (validated spec → growth, echoing the
// Mentible "growing mind"), over a light lower panel carrying the title in serif.
//
// One vector source feeds both targets: inline in the EPUB cover XHTML (page 1 of
// the spine, also registered as the EPUB cover-image) and inline on the PDF's
// first page. Generic — driven entirely by book metadata, no per-title data.

const VW = 1600;
const VH = 2560;
const SPLIT_Y = 1560; // dark field above, light panel below
const MARGIN_L = 150;
const MARGIN_R = 1450;
const USABLE = MARGIN_R - MARGIN_L; // 1300
// Shared serif stack: Source Serif 4 (embedded in the PDF) with broad fallbacks
// so EPUB readers without it still render a proper serif.
const SERIF = "'Source Serif 4', Georgia, 'Times New Roman', 'Liberation Serif', serif";
const SANS = "'Helvetica Neue', 'Liberation Sans', Arial, sans-serif";

export interface CoverInput {
  title: string;
  subtitle?: string; // defaults to the title's parenthetical / colon tail
  tagline?: string; // optional italic line
  author?: string; // byline, e.g. "Sridhar Parthasarathy"
  brand?: string; // footer wordmark, default "MENTIBLE"
}

// Split "Main (Sub)" or "Main: Sub" into a big main title + a smaller subtitle.
// Titles with no delimiter become the main title with no subtitle.
function splitTitle(title: string): { main: string; sub?: string } {
  const t = title.trim();
  const paren = t.indexOf(" (");
  const colon = t.indexOf(": ");
  let cut = -1;
  if (paren >= 0 && (colon < 0 || paren < colon)) cut = paren;
  else if (colon >= 0) cut = colon;
  if (cut < 0) return { main: t };
  const main = t.slice(0, cut).trim();
  const sub = t.slice(t[cut] === ":" ? cut + 1 : cut + 1).trim();
  return { main, sub: sub || undefined };
}

// Greedy word-wrap into at most `maxChars`-wide lines.
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

// Pick the largest font size whose wrapped title fits the usable width in ≤ maxLines.
function fitTitle(text: string, sizes: number[], maxLines: number): { size: number; lines: string[] } {
  for (const size of sizes) {
    const maxChars = Math.floor(USABLE / (0.52 * size));
    const lines = wrap(text, Math.max(maxChars, 1));
    const longest = Math.max(...lines.map((l) => l.length));
    if (lines.length <= maxLines && longest * 0.52 * size <= USABLE) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrap(text, Math.max(Math.floor(USABLE / (0.52 * size)), 1)) };
}

function tspans(lines: string[], x: number, top: number, lineHeight: number): string {
  return lines
    .map((l, i) => `<tspan x="${x}" y="${top + i * lineHeight}">${escapeHtml(l)}</tspan>`)
    .join("");
}

// The bare <svg> (viewBox only — the host sizes it). Used inline in both targets.
export function buildCoverSvg(input: CoverInput): string {
  const brand = input.brand ?? "MENTIBLE";
  const parsed = splitTitle(input.title);
  const subtitle = input.subtitle ?? parsed.sub;

  const main = fitTitle(parsed.main, [148, 128, 112, 98, 86, 76], 3);
  const mainLH = Math.round(main.size * 1.06);
  const titleTop = 1716;
  const titleBottom = titleTop + (main.lines.length - 1) * mainLH;

  let y = titleBottom + 86;
  let subBlock = "";
  if (subtitle) {
    const sub = fitTitle(subtitle, [60, 54, 48, 42], 2);
    const subLH = Math.round(sub.size * 1.12);
    // accent rule sits to the left of the first subtitle line
    subBlock =
      `<rect x="${MARGIN_L + 6}" y="${y - 44}" width="96" height="12" rx="6" fill="${BRAND.green}"/>` +
      `<text fill="${BRAND.green}" font-family="${SERIF}" font-size="${sub.size}" font-weight="800">` +
      tspans(sub.lines, MARGIN_L + 130, y, subLH) +
      `</text>`;
    y += (sub.lines.length - 1) * subLH + 96;
  }

  let taglineBlock = "";
  if (input.tagline) {
    taglineBlock =
      `<text x="${MARGIN_L + 6}" y="${y}" fill="#4b4570" font-family="${SERIF}" ` +
      `font-size="56" font-weight="500" font-style="italic">${escapeHtml(input.tagline)}</text>`;
    y += 104;
  }

  // Author byline ("by <name>") below the title block. Serif, indigo, prominent
  // but smaller than the subtitle. Omitted when no author is supplied.
  let authorBlock = "";
  if (input.author) {
    authorBlock =
      `<text x="${MARGIN_L + 6}" y="${y}" fill="${BRAND.indigo}" font-family="${SERIF}" ` +
      `font-size="60" font-weight="700">${escapeHtml("by " + input.author)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(input.title)}">
  <defs>
    <linearGradient id="cvTop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.indigoLuminous}"/>
      <stop offset="0.6" stop-color="${BRAND.indigo}"/>
      <stop offset="1" stop-color="${BRAND.indigoDark}"/>
    </linearGradient>
    <linearGradient id="cvMark" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${BRAND.green}"/>
      <stop offset="1" stop-color="${BRAND.greenBright}"/>
    </linearGradient>
    <filter id="cvGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="26" flood-color="${BRAND.greenBright}" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect width="${VW}" height="${SPLIT_Y}" fill="url(#cvTop)"/>
  <rect y="${SPLIT_Y}" width="${VW}" height="${VH - SPLIT_Y}" fill="${BRAND.lavender}"/>
  <text x="${MARGIN_L}" y="300" fill="${BRAND.indigoSoft}" font-family="${SANS}" font-size="44" letter-spacing="10" font-weight="600">MENTIBLE&#160;·&#160;AUTHOR’S EDITION</text>
  <g filter="url(#cvGlow)" transform="translate(800,800)">
    <path d="M-300 60 L-110 250 L300 -240" fill="none" stroke="url(#cvMark)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M300 -240 L150 -250 M300 -240 L290 -90" fill="none" stroke="url(#cvMark)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text fill="${BRAND.indigoDark}" font-family="${SERIF}" font-size="${main.size}" font-weight="800" letter-spacing="-2">${tspans(main.lines, MARGIN_L, titleTop, mainLH)}</text>
  ${subBlock}
  ${taglineBlock}
  ${authorBlock}
  <line x1="${MARGIN_L}" y1="2392" x2="${MARGIN_R}" y2="2392" stroke="#d9d2f5" stroke-width="2"/>
  <circle cx="172" cy="2452" r="22" fill="none" stroke="${BRAND.green}" stroke-width="5"/>
  <path d="M172 2440c-14 8-14 26 0 24 14 2 14-16 0-24z" fill="${BRAND.green}"/>
  <text x="214" y="2466" fill="#5b5489" font-family="${SANS}" font-size="42" letter-spacing="7" font-weight="700">${escapeHtml(brand)}</text>
</svg>`;
}

// Standalone .svg file (EPUB cover-image): intrinsic size + XML declaration.
export function buildCoverSvgFile(input: CoverInput): string {
  const svg = buildCoverSvg(input).replace(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox",
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n${svg}`;
}

// Full-bleed EPUB cover page (page 1 of the spine), inlining the SVG. The dark
// page background hides any letterbox bars from preserveAspectRatio="meet".
export function buildCoverXhtml(input: CoverInput): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(input.title)}</title>
<style>html,body{margin:0;padding:0;height:100%;background:${BRAND.indigoDark}}.cv{width:100%;height:100vh}.cv svg{width:100%;height:100%;display:block}</style>
</head>
<body>
<section epub:type="cover" class="cv">
${buildCoverSvg(input)}
</section>
</body>
</html>
`;
}

// Derive cover copy from a book. Subtitle comes from the title split; a tagline
// is only used when the lead topic's synopsis opens with a short, punchy sentence.
export function coverInputForBook(book: Book): CoverInput {
  const content = book.content ?? {};
  let tagline: string | undefined;
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const syn = unit.id ? content[unit.id]?.lesson?.synopsis : undefined;
      if (syn) {
        const first = syn.split(/(?<=[.!?])\s/)[0]?.trim();
        if (first && first.length >= 12 && first.length <= 64) tagline = first;
        break;
      }
    }
    if (tagline !== undefined) break;
  }
  return { title: book.title, tagline, author: book.metadata?.author };
}
