import { strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { openEpub, EpubError, type EpubZip } from "@/storage/epubZip";

// EPUB format code. Knows NOTHING about Mentible — it returns the book's own
// structure, and `epubToBook.ts` maps that onto our types.
//
// An EPUB from an arbitrary catalog is hostile input, exactly like feed XML
// (ADR-028). These parser options are the SAME hardening `opds12.ts` uses:
// processEntities:false is the XXE guarantee (entities are never expanded), and
// parseTagValue:false stops "01" or "1e5" being coerced to numbers.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  parseTagValue: false,
});

export const MAX_CHAPTERS = 2000;

export interface SpineItem {
  id: string;
  title: string;
  html: string;
  /** Zip-relative path → bytes, for images this chapter references. */
  images: Record<string, Uint8Array>;
}

export interface ParsedEpub {
  metadata: { title: string; authors: string[]; language?: string };
  spine: SpineItem[];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

/** Resolve an href relative to the OPF's directory, collapsing `..` segments. */
function resolve(opfDir: string, href: string): string {
  const parts = (opfDir + href).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export function readEpub(bytes: Uint8Array): ParsedEpub {
  const z: EpubZip = openEpub(bytes);
  let pkg;
  try {
    pkg = parser.parse(z.opf)?.package ?? {};
  } catch {
    // fast-xml-parser refuses an OPF that declares external entities
    // (<!ENTITY … SYSTEM …>). That refusal IS the behaviour we want: a hostile
    // or malformed package fails loudly at import rather than being silently
    // "repaired" into something parseable. A benign <!DOCTYPE package PUBLIC …>
    // (no internal subset) parses fine and is unaffected.
    throw new EpubError("This EPUB's package file isn't readable.");
  }
  const meta = pkg.metadata ?? {};

  const metadata = {
    title: text(meta["dc:title"] ?? meta.title) || "Untitled",
    authors: asArray(meta["dc:creator"] ?? meta.creator).map(text).filter(Boolean),
    language: text(meta["dc:language"] ?? meta.language) || undefined,
  };

  // manifest id → href
  const hrefById = new Map<string, string>();
  for (const item of asArray<Record<string, string>>(pkg.manifest?.item)) {
    const id = item["@_id"];
    const href = item["@_href"];
    if (id && href) hrefById.set(id, href);
  }

  const refs = asArray<Record<string, string>>(pkg.spine?.itemref).slice(0, MAX_CHAPTERS);
  if (refs.length === 0) throw new EpubError("This EPUB has no readable chapters.");

  const spine: SpineItem[] = [];
  refs.forEach((ref, i) => {
    const id = ref["@_idref"];
    const href = id ? hrefById.get(id) : undefined;
    if (!href) return;
    const key = z.find(resolve(z.opfDir, href));
    if (!key) return;
    const html = strFromU8(z.files[key]);

    // Title from the chapter's first heading; a positional label otherwise. Never
    // empty — the TOC is how a reader navigates.
    const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html)?.[1] ?? "";
    const title = heading.replace(/<[^>]*>/g, "").trim() || `Chapter ${i + 1}`;

    // Collect ONLY images that live inside the zip. A remote src is ignored here
    // and dropped at rewrite time (Task 3) — never fetched, or opening a book
    // would leak the reader's IP and reading activity to whoever made it.
    const chapterDir = href.includes("/") ? href.slice(0, href.lastIndexOf("/") + 1) : "";
    const images: Record<string, Uint8Array> = {};
    for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
      const src = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) continue; // absolute/protocol-relative → remote
      const imgKey = z.find(resolve(z.opfDir, chapterDir + src));
      if (imgKey) images[src] = z.files[imgKey];
    }

    spine.push({ id: id!, title, html, images });
  });

  if (spine.length === 0) throw new EpubError("This EPUB has no readable chapters.");
  return { metadata, spine };
}
