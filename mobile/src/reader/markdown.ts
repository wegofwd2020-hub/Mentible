// Markdown → HTML for the native web reader. Mirrors the in-iframe helpers in
// `@/components/contentHtml` (RENDER_HELPERS_JS) so the two readers agree on
// markup while the flag is in flight.
//
// NOTHING here sanitizes. `renderContent.ts` makes exactly one sanitize pass
// over the assembled fragment, so every branch below must assume its output is
// still untrusted.
//
// Web-only: pulled in by the `.web` reader only.

import { marked } from "marked";

/** HTML-escape a value for interpolation into markup as text. */
export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const renderer = new marked.Renderer();

renderer.code = function code(source: string, lang: string | undefined): string {
  if (lang === "mermaid") {
    // Escaped: the source is untrusted (spec D4). Mermaid reads `textContent`,
    // which un-escapes, so the diagram still renders.
    return `<div class="mermaid">${escapeHtml(source)}</div>`;
  }
  if (lang === "svg") {
    // Animated educational visuals (the free animated-visual path). Inlined raw so
    // SMIL/CSS animation works; the final DOMPurify pass strips scripts, handlers,
    // and href-targeting animations. Do not pre-strip here — one boundary only.
    return `<figure class="anim-svg">${source}</figure>`;
  }
  return `<pre><code>${escapeHtml(source)}</code></pre>`;
};

/** Markdown → HTML. Math delimiters survive as text for the KaTeX post-pass. */
export function md(text: string | undefined): string {
  return marked.parse(text ?? "", { async: false, renderer }) as string;
}

/** `<li>`-wrap a list of plain-text items. */
export function li(items: string[] | undefined): string {
  return (items ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
}

const normHeading = (s: unknown) =>
  String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The model often repeats a section's heading as a leading `## Heading` line in
 * `body_markdown`. We already emit the heading, so drop the duplicate.
 */
export function stripDupHeading(body: string | undefined, heading: string): string {
  const text = String(body ?? "");
  const m = text.match(/^\s*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (m && m[1] !== undefined && normHeading(m[1]) === normHeading(heading)) {
    return text.slice(m[0].length);
  }
  return text;
}
