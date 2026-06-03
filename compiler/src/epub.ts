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
import { buildCoverSvgFile, buildCoverXhtml, coverInputForBook } from "./cover";
import { colophonSection } from "./colophon";
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

interface ImageRes {
  id: string;
  href: string; // relative to OEBPS/, e.g. images/img-001.jpg
  mediaType: string;
  bytes: Uint8Array;
}

const MEDIA_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

// Pull data-URI images out of chapter XHTML into packaged resources: EPUB3
// requires referenced media to be manifest items, and many readers won't render
// inline data: URIs. Rewrites each `src="data:image/…;base64,…"` to a packaged
// path (../images/img-NNN.ext) and records the bytes. Identical images are
// shared. `images` and `seen` accumulate across chapters.
function packImages(xhtml: string, images: ImageRes[], seen: Map<string, string>): string {
  return xhtml.replace(
    /(src=")data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)(")/gi,
    (_full, pre: string, mediaType: string, b64: string, post: string) => {
      let href = seen.get(b64);
      if (!href) {
        const ext = MEDIA_EXT[mediaType.toLowerCase()] ?? "img";
        const idx = String(images.length + 1).padStart(3, "0");
        href = `images/img-${idx}.${ext}`;
        images.push({
          id: `img${idx}`,
          href,
          mediaType: mediaType.toLowerCase(),
          bytes: new Uint8Array(Buffer.from(b64, "base64")),
        });
        seen.set(b64, href);
      }
      // Chapters live in OEBPS/chapters/, images in OEBPS/images/.
      return `${pre}../${href}${post}`;
    },
  );
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
  const lang = book.metadata?.language || "en";

  // Walk the TOC in reading order; emit a chapter per content-bearing topic and
  // collect the nav structure (subjects with ≥1 chapter).
  const chapters: Chapter[] = [];
  const navSubjects: NavSubject[] = [];
  const images: ImageRes[] = [];
  const seenImages = new Map<string, string>();
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
      const xhtml = packImages(
        xhtmlDocument(title, renderTopicBody(topic, diagrams), "../css/style.css", lang),
        images,
        seenImages,
      );
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

  const coverInput = coverInputForBook(book);
  const coverXhtml = buildCoverXhtml(coverInput);
  const coverSvg = buildCoverSvgFile(coverInput);

  const titleXhtml = xhtmlDocument(
    book.title,
    `<section epub:type="titlepage"><h1>${escapeHtml(book.title)}</h1></section>`,
    "css/style.css",
    lang,
  );
  const colophonXhtml = buildColophon(book, lang);

  const zip = new JSZip();
  // mimetype MUST be the first entry and stored uncompressed (EPUB OCF rule).
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", buildOpf(book, chapters, images));
  zip.file("OEBPS/nav.xhtml", buildNav(navSubjects, lang));
  // EPUB2 NCX navigation alongside the EPUB3 nav — older/"traditional" readers
  // require it and render blank pages without it.
  zip.file("OEBPS/toc.ncx", buildNcx(book, chapters));
  zip.file("OEBPS/css/style.css", STYLESHEET);
  zip.file("OEBPS/cover.xhtml", coverXhtml);
  zip.file("OEBPS/cover.svg", coverSvg);
  zip.file("OEBPS/title.xhtml", titleXhtml);
  zip.file("OEBPS/colophon.xhtml", colophonXhtml);
  for (const ch of chapters) zip.file(`OEBPS/${ch.href}`, ch.xhtml);
  for (const img of images) zip.file(`OEBPS/${img.href}`, img.bytes);

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

function buildNav(subjects: NavSubject[], lang = "en"): string {
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
  return xhtmlDocument("Contents", body, "css/style.css", lang);
}

// A conventional copyright / colophon page, emitted right after the title page.
// Shares colophonSection() with the PDF path so the two artifacts match.
function buildColophon(book: Book, lang: string): string {
  return xhtmlDocument(book.title, colophonSection(book), "css/style.css", lang);
}

// EPUB Accessibility 1.1 metadata (schema.org a11y vocabulary, emitted with the
// EPUB-reserved `schema:`/`a11y:`/`dcterms:` prefixes — no xmlns needed). Values
// are auto-derived from the actual content (math → MathML feature + textual
// access; diagrams/images → a visual access mode) and can be overridden or
// extended via book.metadata.accessibility. We deliberately do NOT auto-claim
// WCAG conformance or `alternativeText`: a formal claim (dcterms:conformsTo /
// a11y:certifiedBy) is only emitted when the author asserts it after an audit.
// See docs/PROFESSIONAL_PUBLISHING.md §7/§14.
function accessibilityMeta(book: Book, chapters: Chapter[], images: ImageRes[]): string[] {
  const a = book.metadata?.accessibility ?? {};
  const hasVisual = images.length > 0 || chapters.some((c) => c.hasSvg);
  const hasMath = chapters.some((c) => c.hasMath);

  const accessModes = a.accessModes ?? ["textual", ...(hasVisual ? ["visual"] : [])];
  const accessModeSufficient = a.accessModeSufficient ?? [hasVisual ? "textual,visual" : "textual"];

  const autoFeatures = ["tableOfContents", "readingOrder", "structuralNavigation", "displayTransformability"];
  if (hasMath) autoFeatures.push("MathML");
  const features = [...new Set([...autoFeatures, ...(a.features ?? [])])];

  const hazards = a.hazards ?? ["none"];
  const summary =
    a.summary ??
    ("Reflowable EPUB with structural navigation, a table of contents, and resizable text." +
      (hasMath ? " Mathematics is encoded as MathML." : "") +
      (hasVisual ? " The publication contains diagrams and images." : ""));

  const out: string[] = [];
  for (const m of accessModes) out.push(`<meta property="schema:accessMode">${escapeHtml(m)}</meta>`);
  for (const s of accessModeSufficient)
    out.push(`<meta property="schema:accessModeSufficient">${escapeHtml(s)}</meta>`);
  for (const f of features) out.push(`<meta property="schema:accessibilityFeature">${escapeHtml(f)}</meta>`);
  for (const h of hazards) out.push(`<meta property="schema:accessibilityHazard">${escapeHtml(h)}</meta>`);
  out.push(`<meta property="schema:accessibilitySummary">${escapeHtml(summary)}</meta>`);
  if (a.conformsTo) out.push(`<link rel="dcterms:conformsTo" href="${escapeHtml(a.conformsTo)}"/>`);
  if (a.certifiedBy) out.push(`<meta property="a11y:certifiedBy">${escapeHtml(a.certifiedBy)}</meta>`);
  return out;
}

function buildOpf(book: Book, chapters: Chapter[], images: ImageRes[] = []): string {
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="css/style.css" media-type="text/css"/>',
    // Cover: the SVG is the EPUB3 cover-image; cover.xhtml is the rendered page
    // (inline SVG → needs the svg property).
    '<item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>',
    '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>',
    '<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>',
    ...images.map(
      (img) => `<item id="${img.id}" href="${escapeHtml(img.href)}" media-type="${img.mediaType}"/>`,
    ),
    ...chapters.map((ch) => {
      const props = [ch.hasMath ? "mathml" : "", ch.hasSvg ? "svg" : ""].filter(Boolean).join(" ");
      const attr = props ? ` properties="${props}"` : "";
      return `<item id="${ch.id}" href="${escapeHtml(ch.href)}" media-type="application/xhtml+xml"${attr}/>`;
    }),
  ];
  const spine = [
    '<itemref idref="cover"/>',
    '<itemref idref="titlepage"/>',
    '<itemref idref="colophon"/>',
    ...chapters.map((ch) => `<itemref idref="${ch.id}"/>`),
  ];

  const m = book.metadata ?? {};
  const lang = m.language || "en";
  const identifier = m.identifier || book.id;
  const meta: string[] = [
    `<dc:identifier id="bookid">${escapeHtml(identifier)}</dc:identifier>`,
    `<dc:title>${escapeHtml(book.title)}</dc:title>`,
    `<dc:language>${escapeHtml(lang)}</dc:language>`,
  ];
  if (m.author) {
    meta.push(`<dc:creator id="creator">${escapeHtml(m.author)}</dc:creator>`);
    meta.push(`<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>`);
    meta.push(`<meta refines="#creator" property="file-as">${escapeHtml(m.authorFileAs || m.author)}</meta>`);
  }
  if (m.publisher) meta.push(`<dc:publisher>${escapeHtml(m.publisher)}</dc:publisher>`);
  if (m.date) meta.push(`<dc:date>${escapeHtml(m.date)}</dc:date>`);
  if (m.description) meta.push(`<dc:description>${escapeHtml(m.description)}</dc:description>`);
  for (const s of m.subjects ?? []) meta.push(`<dc:subject>${escapeHtml(s)}</dc:subject>`);
  if (m.rights) meta.push(`<dc:rights>${escapeHtml(m.rights)}</dc:rights>`);
  if (m.series) {
    meta.push(`<meta property="belongs-to-collection" id="series">${escapeHtml(m.series)}</meta>`);
    meta.push(`<meta refines="#series" property="collection-type">series</meta>`);
    if (m.seriesIndex != null)
      meta.push(`<meta refines="#series" property="group-position">${escapeHtml(String(m.seriesIndex))}</meta>`);
  }
  meta.push(...accessibilityMeta(book, chapters, images));
  meta.push(`<meta name="cover" content="cover-image"/>`);
  meta.push(`<meta property="dcterms:modified">${modifiedTimestamp(book.updatedAt)}</meta>`);

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeHtml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta.join("\n")}
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
