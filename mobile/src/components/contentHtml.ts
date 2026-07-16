// Pure HTML-document builders for the content reader. No React/RN imports, so
// the markup logic is unit-testable in plain jest.
//
// The reader is a self-contained HTML document rendered in a react-native-webview
// on native (web uses the real-DOM reader in `src/reader/`): markdown via `marked`,
// maths via KaTeX, diagrams via Mermaid — all CDN-loaded and run in-page (RN has no
// DOM, so rendering can't happen in the bundle). `buildTopicHtml` renders a full
// multi-format topic (lesson + optional tutorial + quiz sets + experiment).

import { renderTopicToHtml } from "@/reader/topicHtml";
import type { GeneratedTopic } from "@/types/book";
import { colors } from "@/constants/theme";

// In-page render helpers + per-type builders. Inlined as a string because the
// WebView sandbox can't import bundle modules. Uses only single quotes so it
// nests cleanly inside the template literal below.

function htmlDocument(dataJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Source Serif 4 = a clean book serif loaded from the web; "Noto Serif" is
     the on-device fallback so body prose renders serif even offline / when the
     web font is unavailable (the generic serif keyword is not reliable on the
     Android WebView). -->
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"
  crossorigin="anonymous">
<style>
  :root {
    --bg: ${colors.background};
    --surface: ${colors.surface};
    --border: ${colors.border};
    --text: ${colors.text};
    --text2: ${colors.textSecondary};
    --muted: ${colors.textMuted};
    --primary: ${colors.primary};
    --success: ${colors.success};
    --warning: ${colors.warning};
    /* Match the EPUB/PDF artifact: serif body for prose, sans for headings/UI. */
    --sans: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
    --serif: 'Source Serif 4', "Noto Serif", Georgia, "Times New Roman", "Liberation Serif", serif;
    color-scheme: dark;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: var(--bg); }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--serif);
    font-weight: 400;
    font-size: 16px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
    padding: 20px 18px 40px;
    /* Cap the line length for a comfortable reading measure (esp. on tablets). */
    max-width: 42rem;
    margin: 0 auto;
  }
  h1, h2, h3, h4, h5, h6 { font-family: var(--sans); line-height: 1.3; }
  h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 8px; color: var(--text); }
  h2 { font-size: 1.3rem; font-weight: 700; margin: 24px 0 8px; color: var(--text); }
  h3 { font-size: 1.1rem; font-weight: 600; margin: 18px 0 6px; color: var(--text2); }
  h4, h5, h6 { font-size: 1rem; font-weight: 600; margin: 14px 0 4px; }
  p  { margin: 12px 0; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 4px 0; }
  code {
    font-family: "Menlo", "Courier New", monospace;
    font-size: 0.88em;
    background: var(--surface);
    padding: 2px 5px;
    border-radius: 4px;
    color: #e2e8f0;
  }
  pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    overflow-x: auto;
    margin: 12px 0;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid var(--primary);
    padding: 8px 12px;
    margin: 12px 0;
    color: var(--text2);
    font-style: italic;
  }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9em; display: block; overflow-x: auto; }
  th { background: var(--surface); color: var(--text); font-weight: 600; padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
  td { padding: 7px 12px; border: 1px solid var(--border); color: var(--text2); }
  tr:nth-child(even) td { background: var(--surface); }
  a { color: var(--primary); }
  img { max-width: 100%; height: auto; display: block; margin: 12px auto; border-radius: 8px; }
  hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .synopsis {
    color: var(--text2); font-size: 0.95em;
    margin: 12px 0 20px; padding: 12px;
    background: var(--surface); border-radius: 8px;
    border-left: 3px solid var(--primary);
  }
  .objectives, .takeaways, .further, .mistakes, .examples {
    background: var(--surface); border-radius: 8px;
    padding: 12px 16px; margin: 16px 0;
  }
  .objectives { border-left: 3px solid var(--primary); }
  .takeaways  { border-left: 3px solid var(--success); }
  .further    { border-left: 3px solid var(--muted); }
  .mistakes   { border-left: 3px solid var(--warning); }
  .objectives h3 { color: var(--primary); margin-bottom: 8px; }
  .takeaways h3  { color: var(--success);  margin-bottom: 8px; }
  .further h3    { color: var(--muted);   margin-bottom: 8px; }
  .mistakes h3   { color: var(--warning); margin-bottom: 8px; }
  .practice {
    background: var(--surface); border-left: 3px solid var(--warning);
    padding: 8px 12px; border-radius: 6px; margin: 10px 0;
  }
  .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .quiz-q {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 14px; margin: 12px 0;
  }
  .quiz-options { list-style: none; padding-left: 0; margin: 8px 0; }
  .quiz-options li { padding: 4px 0; color: var(--text2); }
  .quiz-options li.correct { color: var(--success); font-weight: 600; }
  .quiz-answer { margin-top: 8px; color: var(--success); font-size: 0.9em; }
  .quiz-expl { color: var(--text2); font-size: 0.9em; }
  .difficulty { margin-top: 6px; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .materials, .safety, .exp-questions { margin: 12px 0; }
  .safety { border-left: 3px solid var(--warning); padding-left: 12px; }
  .step { margin: 8px 0; }
  .step .obs { color: var(--text2); font-style: italic; font-size: 0.92em; }
  .mermaid { margin: 12px 0; }
  .mermaid svg { max-width: 100%; }
  /* Animated SVG figures (free animated-visual path). */
  .anim-svg {
    margin: 16px 0;
    text-align: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
  }
  .anim-svg svg { max-width: 100%; height: auto; }
  .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
  .error-banner { background: #7f1d1d; border-radius: 8px; padding: 12px; color: #fca5a5; }
</style>
</head>
<body>
<div id="root">Loading…</div>

<!-- KaTeX and Mermaid are still fetched, because bundling them is ~4.8MB
     (mermaid alone is 3.2MB, and katex.min.css pulls 60 font files) — out of
     scope for #325. They are therefore OPTIONAL: the body is already rendered
     HTML, so text and figures show with or without them. Every use below is
     guarded; their absence must never blank the page again. -->
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js" crossorigin="anonymous"></script>

<script>
(function () {
  var DATA = ${dataJson};

  // The body arrived as finished HTML, rendered in RN by @/reader/topicHtml.
  // Nothing here parses markdown, so no CDN script is needed to show the text
  // (#325). DATA.__html is a string built by our own renderer — the same string
  // the web reader sanitizes — and is assigned exactly once.
  document.getElementById('root').innerHTML = DATA.__html;

  // Math: optional. Offline, renderMathInElement is simply absent — leave the
  // source text as-is rather than throwing and losing the whole document.
  if (typeof renderMathInElement === 'function') {
    try {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false },
        ],
        ignoredClasses: ['mermaid'],
        throwOnError: false,
      });
    } catch (e) { /* math stays as source text; the lesson still reads */ }
  }

  // Diagrams: optional, same reasoning. A mermaid block degrades to its own
  // source text inside .mermaid rather than taking the page down.
  if (typeof mermaid !== 'undefined' && mermaid && typeof mermaid.initialize === 'function') {
    try {
      mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
    } catch (e) { /* diagram source remains visible */ }
  }
})();
</script>
</body>
</html>`;
}

/**
 * JSON for embedding inside an HTML `<script>` block.
 *
 * `JSON.stringify` alone is NOT safe here: it does not escape `</script>`, so any
 * content containing that literal closes the block and the remainder becomes live
 * DOM (GHSA-48wh-p7cx-c87j). That is not a hypothetical for a product that
 * teaches — a lesson *about web development* containing `</script>` in an example
 * is expected content.
 *
 * Escaping `<` as its unicode escape keeps the output valid JSON *and* valid JS
 * (`JSON.parse` and the JS parser both read `\u003c` as `<`), so the data
 * round-trips byte-for-byte while never terminating a tag. `\u2028`/`\u2029` are
 * escaped for the same reason: legal in JSON, line terminators in JS.
 */
function jsonForScriptBlock(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Full multi-format topic — lesson plus any of tutorial / quiz sets / experiment /
 * attached figures.
 *
 * The body is rendered HERE, in RN, by the shared `renderTopicToHtml` — the same
 * renderer the web reader uses. The WebView receives finished HTML and parses no
 * markdown, which is what lets the reader work offline (#325) and what allowed the
 * ~130-line duplicate renderer that used to live in this file to be deleted.
 */
export function buildTopicHtml(topic: GeneratedTopic, dataUrls?: Map<string, string>): string {
  return htmlDocument(jsonForScriptBlock({ __html: renderTopicToHtml(topic, dataUrls) }));
}
