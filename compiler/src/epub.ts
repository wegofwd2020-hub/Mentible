import JSZip from "jszip";
import { renderTopicBody } from "./renderCore";
import {
  PassthroughDiagramRenderer,
  PrerenderedDiagramRenderer,
  type DiagramRenderer,
} from "./diagrams";
import { prerenderDiagrams, type MermaidRenderer } from "./mermaid";
import { xhtmlDocument } from "./xhtml";
import { STYLESHEET } from "./css";
import { escapeHtml } from "./html";
import type { Book } from "./types";

// Compile a canonical Book (book.json) into a self-contained EPUB3 (milestone 2).
// Content is pre-rendered (MathML + diagram fragments) so the artifact needs no
// runtime JS or network. Quizzes are a static answer key; the interactive layer
// is a later phase (ADR-004). Topics without generated content are skipped.

export class EmptyBookError extends Error {
  constructor() {
    super("Book has no generated content to compile.");
    this.name = "EmptyBookError";
  }
}

export interface CompileOptions {
  // Override the diagram renderer directly (defaults to the passthrough stub).
  diagrams?: DiagramRenderer;
  // When set, diagrams are pre-rendered to inline SVG with this renderer before
  // compiling (async). Takes precedence over `diagrams`. See mermaid.ts.
  mermaid?: MermaidRenderer;
}

interface Chapter {
  id: string;
  href: string; // relative to OEBPS/
  title: string;
  xhtml: string;
  hasMath: boolean;
  hasSvg: boolean;
}

interface NavSubject {
  label: string;
  items: { href: string; title: string }[];
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

// dcterms:modified must be UTC with no fractional seconds (EPUB3 requirement).
function modifiedTimestamp(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return safe.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function compileEpub(book: Book, opts: CompileOptions = {}): Promise<Uint8Array> {
  // Diagram strategy: a Mermaid renderer (pre-render to SVG) wins, else an
  // explicit override, else the passthrough placeholder.
  let diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  if (opts.mermaid) {
    diagrams = new PrerenderedDiagramRenderer(await prerenderDiagrams(book, opts.mermaid));
  }
  const content = book.content ?? {};

  // Walk the TOC in reading order; emit a chapter per content-bearing topic and
  // collect the nav structure (subjects with ≥1 chapter).
  const chapters: Chapter[] = [];
  const navSubjects: NavSubject[] = [];
  let n = 0;
  for (const subject of book.toc.subjects) {
    const items: NavSubject["items"] = [];
    for (const unit of subject.units) {
      const topic = unit.id ? content[unit.id] : undefined;
      if (!topic) continue;
      n += 1;
      const idx = String(n).padStart(3, "0");
      const href = `chapters/ch-${idx}.xhtml`;
      const title = topic.title || unit.title || `Topic ${n}`;
      const xhtml = xhtmlDocument(title, renderTopicBody(topic, diagrams), "../css/style.css");
      chapters.push({
        id: `ch${idx}`,
        href,
        title,
        xhtml,
        hasMath: xhtml.includes("<math"),
        hasSvg: xhtml.includes("<svg"),
      });
      items.push({ href, title });
    }
    if (items.length) navSubjects.push({ label: subject.subject_label, items });
  }

  if (chapters.length === 0) throw new EmptyBookError();

  const titleXhtml = xhtmlDocument(
    book.title,
    `<section epub:type="titlepage"><h1>${escapeHtml(book.title)}</h1></section>`,
    "css/style.css",
  );

  const zip = new JSZip();
  // mimetype MUST be the first entry and stored uncompressed (EPUB OCF rule).
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", buildOpf(book, chapters));
  zip.file("OEBPS/nav.xhtml", buildNav(navSubjects));
  // EPUB2 NCX navigation alongside the EPUB3 nav — older/"traditional" readers
  // require it and render blank pages without it.
  zip.file("OEBPS/toc.ncx", buildNcx(book, chapters));
  zip.file("OEBPS/css/style.css", STYLESHEET);
  zip.file("OEBPS/title.xhtml", titleXhtml);
  for (const ch of chapters) zip.file(`OEBPS/${ch.href}`, ch.xhtml);

  return zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip" });
}

// EPUB2 NCX navigation document. Flat navMap (one point per chapter) — enough
// for traditional readers to render and navigate; the EPUB3 nav.xhtml carries
// the subject grouping.
function buildNcx(book: Book, chapters: Chapter[]): string {
  const navPoints = chapters
    .map(
      (ch, i) =>
        `<navPoint id="np-${i + 1}" playOrder="${i + 1}">` +
        `<navLabel><text>${escapeHtml(ch.title)}</text></navLabel>` +
        `<content src="${escapeHtml(ch.href)}"/></navPoint>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${escapeHtml(book.id)}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeHtml(book.title)}</text></docTitle>
<navMap>
${navPoints}
</navMap>
</ncx>
`;
}

function buildNav(subjects: NavSubject[]): string {
  let ol = "<ol>";
  for (const s of subjects) {
    ol += `<li><span>${escapeHtml(s.label)}</span><ol>`;
    for (const it of s.items) {
      ol += `<li><a href="${escapeHtml(it.href)}">${escapeHtml(it.title)}</a></li>`;
    }
    ol += "</ol></li>";
  }
  ol += "</ol>";
  const body = `<nav epub:type="toc" id="toc"><h1>Contents</h1>${ol}</nav>`;
  return xhtmlDocument("Contents", body, "css/style.css");
}

function buildOpf(book: Book, chapters: Chapter[]): string {
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="css/style.css" media-type="text/css"/>',
    '<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((ch) => {
      const props = [ch.hasMath ? "mathml" : "", ch.hasSvg ? "svg" : ""].filter(Boolean).join(" ");
      const attr = props ? ` properties="${props}"` : "";
      return `<item id="${ch.id}" href="${escapeHtml(ch.href)}" media-type="application/xhtml+xml"${attr}/>`;
    }),
  ];
  const spine = [
    '<itemref idref="titlepage"/>',
    ...chapters.map((ch) => `<itemref idref="${ch.id}"/>`),
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeHtml(book.id)}</dc:identifier>
<dc:title>${escapeHtml(book.title)}</dc:title>
<dc:language>en</dc:language>
<meta property="dcterms:modified">${modifiedTimestamp(book.updatedAt)}</meta>
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>
`;
}
