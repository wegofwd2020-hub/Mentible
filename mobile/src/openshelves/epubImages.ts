import { toBase64 } from "@/storage/epubLibrary";

// Import does NOT touch the chapter's HTML — it has no DOM to parse with
// (Hermes), and five rounds of regex rewriting proved string matching cannot
// do that job safely (a remote tracking URL survived every round: a decoy
// `data-src`, a duplicate `src`, `srcset`, a quote-blind `[^>]*`, and entire
// untouched vectors like `<picture><source>`, SVG `<image href>`, `<object
// data>`, `<iframe src>`, `<video poster>`, and `style="background:url(…)"`).
//
// The fix is architectural, not a better regex: stop parsing HTML at import
// time. This module only turns the zip's own image bytes into `data:` URIs,
// keyed by their in-zip path. The render boundary (a real parsed DOM) owns
// the markup — it walks the DOM, swaps each `<img src>` for its `data:` URI
// from this map, and drops every remaining non-`data:` reference. See
// `mobile/src/lib/figuresHtml.ts` + `resolveFigureDataUrls` for the same
// refs-in-schema idiom already shipped for topic figures.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};

function mimeFor(path: string): string | undefined {
  return MIME[path.split(".").pop()?.toLowerCase() ?? ""];
}

/**
 * A chapter's in-zip images as `zip path → data: URI`.
 *
 * Import does NOT touch the chapter's HTML — it has no DOM to parse with (Hermes),
 * and five rounds of regex rewriting proved string matching cannot do this job
 * safely. The render boundary owns the markup: it walks a REAL parsed DOM, swaps
 * each <img src> for its data: URI from this map, and drops every non-data:
 * reference. This module only turns bytes into URIs.
 */
export function chapterImageMap(images: Record<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(images)) {
    if (bytes.byteLength > MAX_IMAGE_BYTES) continue;
    const mime = mimeFor(path);
    if (!mime) continue;
    // Slice to a fresh, zero-offset buffer before encoding: `bytes` may be a
    // view over a larger underlying ArrayBuffer (e.g. a subarray handed back
    // by the zip reader), and `bytes.buffer` alone would carry that offset
    // and length through to toBase64, encoding neighbouring bytes too.
    out[path] = `data:${mime};base64,${toBase64(bytes.slice().buffer)}`;
  }
  return out;
}
