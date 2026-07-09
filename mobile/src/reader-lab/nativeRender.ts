// SPIKE (throwaway) — the "reader quality" half of the web-native-reader thesis.
// Renders a lesson into a SANITIZED HTML fragment for injection into the real web
// DOM (no iframe). This is the counterpart to contentHtml.ts's in-iframe path;
// the point of the spike is to compare native DOM rendering (real fonts, text
// selection, find-in-page, print, a11y) against the sandboxed iframe.
//
// Because there is no iframe boundary here, sanitization is MANDATORY, not
// optional: model- and shared-book content is untrusted. DOMPurify runs over the
// marked output before it ever touches the DOM. KaTeX math is rendered separately,
// on the mounted node, by the component (renderMathInElement).
//
// Web-only: DOMPurify needs a DOM, so this module must never be imported on native.

import { marked } from "marked";
import DOMPurify from "dompurify";
import type { LessonOutput } from "@/types/lesson";

// KaTeX is rendered post-mount, so `$...$` / `$$...$$` must survive sanitization
// as literal text. marked emits them as text nodes already; DOMPurify keeps text.
function md(text: string): string {
  return marked.parse(text ?? "", { async: false }) as string;
}

function list(items: string[] | undefined): string {
  return (items ?? []).map((x) => `<li>${md(x)}</li>`).join("");
}

// Build the lesson body as one HTML string. Mirrors contentHtml.ts's lesson shape
// (synopsis → objectives → sections → takeaways) so the visual comparison is fair.
function lessonHtml(lesson: LessonOutput): string {
  const parts: string[] = [];
  parts.push(`<h1>${DOMPurify.sanitize(lesson.topic ?? "")}</h1>`);
  if (lesson.synopsis) parts.push(`<blockquote class="synopsis">${md(lesson.synopsis)}</blockquote>`);
  if (lesson.learning_objectives?.length) {
    parts.push(`<section class="objectives"><h2>Learning objectives</h2><ul>${list(lesson.learning_objectives)}</ul></section>`);
  }
  for (const s of lesson.sections ?? []) {
    parts.push(`<section><h2>${DOMPurify.sanitize(s.heading ?? "")}</h2>${md(s.body_markdown ?? "")}</section>`);
  }
  if (lesson.key_takeaways?.length) {
    parts.push(`<section class="takeaways"><h2>Key takeaways</h2><ul>${list(lesson.key_takeaways)}</ul></section>`);
  }
  return parts.join("\n");
}

/** Untrusted lesson → sanitized HTML fragment, safe to inject into the app DOM. */
export function renderLessonToSafeHtml(lesson: LessonOutput): string {
  // One final sanitize pass over the whole fragment. KEEP KaTeX-relevant markup:
  // math is plain text at this stage, so default config is fine. SVG/MathML that
  // KaTeX produces is added AFTER this pass, by renderMathInElement on the node.
  return DOMPurify.sanitize(lessonHtml(lesson), { USE_PROFILES: { html: true } });
}
