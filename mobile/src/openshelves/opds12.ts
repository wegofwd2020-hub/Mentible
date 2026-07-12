// mobile/src/openshelves/opds12.ts
// OPDS 1.2 (Atom) parser — THE attack surface (spec §7). fast-xml-parser is pure
// JS with NO external-entity resolution; `processEntities: false` disables even
// internal entity expansion, closing XXE by construction. Output fields are
// plaintext-normalized; nothing is fetched, nothing is executed.
import { XMLParser } from "fast-xml-parser";
import type { AcquisitionLink, FeedEntry } from "./types";
import { FeedParseError } from "./errors";
import { mediaTypeFromMime, toPlainText } from "./normalize";

export const MAX_ENTRIES = 5000;
const SUPPORT = "support_mentible@mambakkam.net";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false, // XXE guarantee — never expand entities
  isArray: (name) =>
    name === "entry" || name === "link" || name === "author" || name === "category",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: any): string {
  // fast-xml-parser puts element text under #text when attributes exist, else the value itself.
  if (v == null) return "";
  if (typeof v === "object") return toPlainText(v["#text"] ?? "");
  return toPlainText(String(v));
}

function firstLangKey(entry: any): string | null {
  const v = entry["dc:language"] ?? entry["dcterms:language"] ?? entry["language"];
  const t = text(v);
  return t || null;
}

function parseLinks(entry: any): { links: AcquisitionLink[]; cover: string | null; canonical: string | null } {
  const links: AcquisitionLink[] = [];
  let cover: string | null = null;
  let canonical: string | null = null;
  for (const l of asArray<any>(entry.link)) {
    const href = String(l["@_href"] ?? "");
    const rel = String(l["@_rel"] ?? "");
    const type = String(l["@_type"] ?? "");
    if (!href) continue;
    if (/image|thumbnail/i.test(rel)) {
      if (!cover) cover = href;
      continue;
    }
    if (rel === "alternate" || rel === "self") {
      if (!canonical) canonical = href;
    }
    if (/acquisition|open-access/i.test(rel) || /epub|pdf|audio|video|mobi/i.test(type)) {
      links.push({ href, mimeType: type, rel });
    }
  }
  return { links, cover, canonical };
}

function isMature(entry: any): boolean | null {
  for (const c of asArray<any>(entry.category)) {
    const term = String(c["@_term"] ?? "");
    const scheme = String(c["@_scheme"] ?? "");
    if (/mature|adult|explicit/i.test(term) || /mature|adult|explicit/i.test(scheme)) return true;
  }
  return null;
}

function toEntry(raw: any): FeedEntry | null {
  const id = text(raw.id);
  if (!id) return null; // no stable key → cannot reconcile (spec P0-4)
  const authors = asArray<any>(raw.author)
    .map((a) => text(a?.name))
    .filter((n) => n.length > 0);
  const categories = asArray<any>(raw.category)
    .map((c) => toPlainText(String(c["@_label"] ?? c["@_term"] ?? "")))
    .filter((t) => t.length > 0);
  const { links, cover, canonical } = parseLinks(raw);
  const primaryMime = links.find((l) => mediaTypeFromMime(l.mimeType) !== "other")?.mimeType ?? null;
  return {
    id,
    title: text(raw.title),
    authors,
    summary: text(raw.summary) || text(raw.content),
    coverUrl: cover,
    language: firstLangKey(raw),
    categories,
    mediaType: mediaTypeFromMime(primaryMime),
    rightsText: text(raw.rights) || text(raw["dcterms:rights"]) || null,
    mature: isMature(raw),
    links,
    canonicalUrl: canonical,
  };
}

export function parseOpds12(xml: string): { feedTitle: string | null; entries: FeedEntry[] } {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new FeedParseError(`could not parse feed XML: ${(err as Error).message}`);
  }
  const feed = doc?.feed;
  if (!feed || typeof feed !== "object") {
    throw new FeedParseError(
      `not an OPDS feed. Only OPDS catalogs are supported — email ${SUPPORT} to request another format.`,
    );
  }
  const feedTitle = text(feed.title) || null;
  const rawEntries = asArray<any>(feed.entry).slice(0, MAX_ENTRIES);
  const entries: FeedEntry[] = [];
  for (const r of rawEntries) {
    const e = toEntry(r);
    if (e) entries.push(e);
  }
  return { feedTitle, entries };
}
