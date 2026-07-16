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
    // SMIL/CSS animation works.
    //
    // The <script> strip is NOT redundant with DOMPurify, because DOMPurify only
    // runs on web. This renderer is shared with the native reader, whose WebView
    // has no DOM-side sanitizer, so on that path this strip is the only thing
    // between an LLM-authored ```svg block and script execution. The WebView's
    // now-deleted duplicate renderer stripped here for exactly this reason
    // ("animation needs no JS, and SVG <script> would run in the WebView") and
    // dropping it while unifying the two would have been a silent regression.
    //
    // This is a targeted strip, NOT a second sanitizer: it does not attempt
    // handlers, javascript: hrefs, or href-targeting animations. On web DOMPurify
    // still handles those. Native's missing sanitizer is a real gap, tracked in
    // #325 and the F1 spec (D-I4) — this line does not close it.
    const noScript = source.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
    return `<figure class="anim-svg">${noScript}</figure>`;
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
