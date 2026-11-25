// Pure policy for server-supplied (Author Commons) cover SVG: untrusted input per
// ADR-028. The actual sanitizing is delegated to the existing `sanitizeFragment`
// (@/reader/sanitize — DOMPurify, web-only) via `sanitizeCover.web.ts`; this file
// holds no sanitizer and no DOM dependency, so it is testable and native-safe.

/** Mirrors the backend publish cap (commons_metadata.py). */
export const MAX_COVER_SVG_CHARS = 100_000;

/**
 * Run `sanitize` over an untrusted cover. Returns the sanitized `<svg>` markup, or
 * undefined (caller shows the placeholder) when the input is missing, oversize,
 * sanitizes to empty, or no longer contains an <svg> root.
 */
export function sanitizeCoverWith(
  sanitize: (html: string) => string,
  svg: string | null | undefined,
): string | undefined {
  if (typeof svg !== "string" || !svg.trim() || svg.length > MAX_COVER_SVG_CHARS) return undefined;
  let clean: string;
  try {
    clean = sanitize(svg).trim();
  } catch {
    return undefined;
  }
  return /^<svg[\s>]/i.test(clean) ? clean : undefined;
}
