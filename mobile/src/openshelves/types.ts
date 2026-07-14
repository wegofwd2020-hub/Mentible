// Open Shelves catalog schema (spec P0-3). Metadata only — NEVER content payloads.
// All string fields are plaintext-normalized at parse (spec §7); `links` carry
// content URLs but no bytes are stored.

export type MediaType = "book" | "audio" | "video" | "other";

export interface AcquisitionLink {
  href: string;
  mimeType: string; // e.g. "application/epub+zip"
  rel: string; // OPDS/Atom link rel
}

export interface FeedEntry {
  id: string; // Atom entry id — the stable reconcile key (spec P0-4)
  title: string;
  authors: string[];
  summary: string;
  coverUrl: string | null;
  language: string | null; // dc:language (spec F-1)
  categories: string[]; // category/subject terms (spec F-2)
  mediaType: MediaType; // derived from acquisition-link MIME (spec F-3)
  rightsText: string | null; // license/rights as provided (spec P0-7)
  mature: boolean | null; // feed maturity flag where present (spec D8/F-4)
  links: AcquisitionLink[];
  canonicalUrl: string | null;
  navigationUrl: string | null; // subsection/opds-catalog link → drill-in (spec N1)
}

export interface FeedSource {
  id: string; // local uuid
  url: string; // https feed URL
  title: string | null; // feed title from parse
  addedAt: string; // ISO 8601
  lastRefreshedAt: string | null;
  isStarter: boolean; // from the owner-curated starter list (spec P0-5)
  entryCount: number; // cached count for the Sources list (spec P0-1)
}
