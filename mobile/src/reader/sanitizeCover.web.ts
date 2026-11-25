import { sanitizeFragment } from "@/reader/sanitize";
import { sanitizeCoverWith } from "@/reader/coverSvg";

/** Untrusted cover SVG → sanitized markup (existing DOMPurify SVG profile) or undefined. */
export function sanitizeCoverSvg(svg: string | null | undefined): string | undefined {
  return sanitizeCoverWith(sanitizeFragment, svg);
}
