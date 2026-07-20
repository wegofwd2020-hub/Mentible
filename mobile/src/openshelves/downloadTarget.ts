// Pure: pick a downloadable acquisition link and resolve its URL to an absolute
// http/https address. Closes the plan-4 relative-URL gap and re-asserts the
// scheme allowlist at download-selection time. Video is never downloadable.
import type { AcquisitionLink, FeedEntry } from "./types";

export function resolveUrl(baseFeedUrl: string, href: string): string | null {
  const h = (href ?? "").trim();
  if (!h) return null;
  let abs: URL;
  try {
    abs = new URL(h, baseFeedUrl); // resolves relative against the feed URL
  } catch {
    return null;
  }
  if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
  return abs.toString();
}

// Preference order by MIME; video is intentionally excluded.
function rank(mime: string): number {
  const m = mime.toLowerCase();
  if (m === "application/epub+zip") return 0;
  if (m === "application/pdf") return 1;
  if (m.startsWith("audio/")) return 2;
  return 99;
}

export function pickDownloadLink(
  entry: FeedEntry,
  baseFeedUrl: string,
): { url: string; mimeType: string } | null {
  const candidates = entry.links
    .filter((l: AcquisitionLink) => rank(l.mimeType) < 99)
    .sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  for (const l of candidates) {
    const url = resolveUrl(baseFeedUrl, l.href);
    if (url) return { url, mimeType: l.mimeType };
  }
  return null;
}
