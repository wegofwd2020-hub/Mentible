// Plaintext normalization for untrusted feed strings (spec §7). This is
// normalization, NOT an HTML sanitizer: it decodes entities and strips ALL tags
// so the result is inert text safe to render in an RN <Text>. HTML *rendering*
// on web (a later UI plan) reuses sanitizeFragment (reader/sanitize.ts, web-only).
import type { MediaType } from "./types";

export const MAX_FIELD_LEN = 4096;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function isValidCodePoint(cp: number): boolean {
  return (
    Number.isFinite(cp) &&
    cp >= 0 &&
    cp <= 0x10ffff &&
    !(cp >= 0xd800 && cp <= 0xdfff)
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return isValidCodePoint(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = parseInt(d, 10);
      return isValidCodePoint(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m));
}

export function toPlainText(raw: string | null | undefined): string {
  if (raw == null) return "";
  const decoded = decodeEntities(String(raw));
  const noTags = decoded.replace(/<[^>]*>/g, " ");
  const collapsed = noTags.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_FIELD_LEN ? collapsed.slice(0, MAX_FIELD_LEN) : collapsed;
}

export function mediaTypeFromMime(mime: string | null | undefined): MediaType {
  const m = (mime ?? "").toLowerCase();
  if (
    m === "application/epub+zip" ||
    m === "application/pdf" ||
    m === "application/x-mobipocket-ebook"
  )
    return "book";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "other";
}
