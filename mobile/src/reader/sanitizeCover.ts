import { sanitizeCoverWith } from "@/reader/coverSvg";

// Native has no DOM, so the existing sanitizer (`@/reader/sanitize`, DOMPurify) cannot
// run here. We do NOT write a second one: an untrusted shared cover is refused and the
// placeholder shows instead. Web (`sanitizeCover.web.ts`) renders the sanitized cover.
export function sanitizeCoverSvg(svg: string | null | undefined): string | undefined {
  return sanitizeCoverWith(() => "", svg);
}
