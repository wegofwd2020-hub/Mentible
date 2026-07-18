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
import { DOMPURIFY_SRC } from "@/components/dompurifySource";

// In-page render helpers + per-type builders. Inlined as a string because the
// WebView sandbox can't import bundle modules. Uses only single quotes so it
// nests cleanly inside the template literal below.

// ---------------------------------------------------------------------------
// Native topic sanitizer — the WebView IS the sanitizer.
//
// A generated topic's body comes from OUR OWN renderer (`renderTopicToHtml`)
// over schema-validated LLM output, but that is not the whole trust story any
// more: the same document also renders a SHARED DRAFT (ADR-027), i.e.
// another user's authored HTML. Native has no DOM outside this WebView to
// sanitize third-party content with, so DOMPurify runs HERE, inlined rather
// than fetched (same #325 offline reasoning as the chapter WebView), and the
// body is sanitized before it is EVER assigned to innerHTML. Without this, an
// `<img onerror>` in a shared draft runs JS in the app's own document, where
// localStorage holds the BYOK key and the Supabase session.
//
// `TOPIC_SANITIZE_HOOK_JS` is a re-authored copy of `@/reader/sanitize`'s
// `makeTopicSanitizeHook` — the WebView sandbox cannot import that module (no
// DOM on Hermes to run it on in the RN bundle, and the WebView itself can't
// `require()` app code). It is ported from the Open Shelves F1 chapter
// sanitizer's `CHAPTER_SANITIZE_HOOK_JS`, with the per-book image-map lookup
// dropped: a topic has no image map, so `src` reduces to the same
// data:-or-drop rule as every other URI attribute below (exactly like the web
// `makeTopicSanitizeHook`, not the chapter hook's map-then-fallback). The two
// copies (this one and the web one) are tested against the SAME vector table
// (`@/reader/topicSanitizeVectors.fixtures`) so they cannot silently drift
// apart.
const TOPIC_SANITIZE_HOOK_JS = `
function makeTopicSanitizeHook() {
  // BARE-URI attributes — data:-only. Matches @/reader/sanitize's URI_ATTRS.
  // 'srcset' is deliberately ABSENT — dropped wholesale via FORBID_ATTR
  // instead (a candidate LIST; a data:-or-drop test that only reads the START
  // of the value is the wrong shape for it).
  var URI_ATTRS = ['src', 'href', 'poster', 'data', 'xlink:href', 'background',
    'cite', 'color-profile'];
  // SVG paint attributes taking a CSS url(...) value. DOMPurify permits all of
  // them and screens none — IS_ALLOWED_URI only reads a value as a URI when it
  // starts with a bare scheme:, and these start with 'url('. They ARE a real
  // fetch channel (Chromium 150 verified: external fill/filter/mask/clip-path
  // paint servers all fetch). ALLOWLISTED by isSafePaintValue, not blocklisted.
  // Matches @/reader/sanitize's PAINT_ATTRS.
  var PAINT_ATTRS = ['fill', 'stroke', 'filter', 'mask', 'clip-path',
    'marker-start', 'marker-mid', 'marker-end'];
  var MAX_SVG_DEPTH = 4;
  var svgDepth = 0;

  function isDataUri(v) {
    return typeof v === 'string' && /^\\s*data:/i.test(v);
  }
  function isFragmentOnlyHref(v) {
    return typeof v === 'string' && v.charAt(0) === '#';
  }
  // ONE safe paint token: keyword, hex colour, number/percentage, or a numeric
  // colour function whose args are digits + separators only.
  // Matches @/reader/sanitize's isSafePaintToken.
  function isSafePaintToken(t) {
    return /^[A-Za-z][A-Za-z-]*$/.test(t)
      || /^#[0-9A-Fa-f]{3,8}$/.test(t)
      || /^[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)%?$/.test(t)
      || /^(?:rgba?|hsla?)\\([\\d.,%\\s/+-]+\\)$/i.test(t);
  }
  // ALLOWLIST — anything not positively recognised is refused. Accepts a
  // same-document url(#ident) (optionally quoted, optionally followed by ONE
  // fallback token, e.g. fill="url(#g) red"), or a bare safe token. Refuses any
  // value containing a backslash (a CSS escape can spell any token at all),
  // any url() that is not same-document, and any unrecognised function
  // (image-set(), var(), …). Matches @/reader/sanitize's isSafePaintValue —
  // see that file for why this is an allowlist and not another blocklist.
  function isSafePaintValue(v) {
    if (typeof v !== 'string') return false;
    if (v.indexOf('\\\\') !== -1) return false;
    var s = v.trim();
    if (s === '') return true;
    var m = /^url\\(\\s*(?:"([^"'()\\\\<>\\s]+)"|'([^"'()\\\\<>\\s]+)'|([^"'()\\\\<>\\s]+))\\s*\\)/i.exec(s);
    if (!m) return isSafePaintToken(s);
    var ident = m[1] || m[2] || m[3];
    if (ident.charAt(0) !== '#') return false;
    var rest = s.slice(m[0].length).trim();
    return rest === '' || isSafePaintToken(rest);
  }
  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
  }

  function sanitizeSvgDataUri(uri) {
    var m = /^\\s*data:image\\/svg\\+xml(?:;charset=[^;,]+)?(;base64)?,([\\s\\S]*)$/i.exec(uri);
    if (!m) return null;
    if (svgDepth >= MAX_SVG_DEPTH) return null;
    var svgText;
    try {
      svgText = m[1] ? base64ToUtf8(m[2]) : decodeURIComponent(m[2]);
    } catch (e) {
      return null;
    }
    svgDepth++;
    var clean;
    try {
      clean = DOMPurify.sanitize(svgText, {
        USE_PROFILES: { svg: true },
        FORBID_TAGS: ['script', 'foreignObject', 'style'],
        // This nested call passes its OWN config — without this, the style
        // surface reopens one level down inside a data: URI. Matches
        // @/reader/sanitize's HOOKLESS_FORBID_ATTR.
        FORBID_ATTR: ['style', 'srcset'],
      });
    } finally {
      svgDepth--;
    }
    if (!clean) return null;
    try {
      return 'data:image/svg+xml;base64,' + utf8ToBase64(clean);
    } catch (e) {
      return null;
    }
  }

  return function (node) {
    if (!node || !node.getAttribute) return;

    for (var i = 0; i < URI_ATTRS.length; i++) {
      var attr = URI_ATTRS[i];
      if (!node.hasAttribute || !node.hasAttribute(attr)) continue;
      var val = node.getAttribute(attr);
      if (attr === 'href' && isFragmentOnlyHref(val)) continue;
      if (!isDataUri(val)) {
        node.removeAttribute(attr);
        continue;
      }
      if (/^\\s*data:image\\/svg\\+xml/i.test(val)) {
        var safe = sanitizeSvgDataUri(val);
        if (safe) node.setAttribute(attr, safe);
        else node.removeAttribute(attr);
      }
    }

    for (var j = 0; j < PAINT_ATTRS.length; j++) {
      var paintAttr = PAINT_ATTRS[j];
      if (!node.hasAttribute || !node.hasAttribute(paintAttr)) continue;
      if (!isSafePaintValue(node.getAttribute(paintAttr))) node.removeAttribute(paintAttr);
    }

    // NOTE: no 'style' screen here either, by design — the attribute is
    // dropped wholesale via FORBID_ATTR before this hook runs. CSS is not
    // screenable by a token blocklist (image-set() needs no url( token, CSS
    // escapes spell url( without the letters, and var() puts the URL in a
    // different attribute entirely). Do not reintroduce one.
  };
}
`;

// Matches `@/reader/sanitize`'s SANITIZE_CONFIG exactly (animation allowances
// + the same FORBID_TAGS/FORBID_ATTR — 'style' and 'srcset' are the two
// surfaces this boundary DELETES rather than screens; see
// HOOKLESS_FORBID_ATTR in `@/reader/sanitize` for why).
const TOPIC_SANITIZE_CONFIG_JS = `{
    USE_PROFILES: { html: true, svg: true },
    ADD_TAGS: ['animate', 'animateTransform', 'set'],
    ADD_ATTR: ['attributeName', 'attributeType', 'values', 'from', 'to', 'by',
      'dur', 'begin', 'end', 'repeatCount', 'repeatDur', 'restart',
      'keyTimes', 'keySplines', 'calcMode', 'additive', 'accumulate', 'fill'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'foreignObject', 'style'],
    FORBID_ATTR: ['srcdoc', 'formaction', 'xlink:href', 'style', 'srcset'],
  }`;

function htmlDocument(dataJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Defense-in-depth BEHIND DOMPurify: the topic document legitimately loads
     the Google-Fonts/KaTeX stylesheet + KaTeX/Mermaid/Google-Fonts CDN
     scripts and fonts, so this CSP is scoped to exactly those origins rather
     than the chapter WebView's stricter default-src none. connect-src stays
     'none' as an egress backstop — nothing in this document should ever open
     its own network connection beyond the declared style/script/font loads. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'none'">
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

<!-- DOMPurify, inlined (not fetched — see the file-level comment above). -->
<script>${DOMPURIFY_SRC}</script>
<script>${TOPIC_SANITIZE_HOOK_JS}</script>
<script>
(function () {
  var DATA = ${dataJson};

  // The body arrived as finished HTML, rendered in RN by @/reader/topicHtml —
  // but that renderer's OWN output can carry another user's shared-draft HTML
  // (ADR-027), which is untrusted the same way an imported chapter is. Sanitize
  // BEFORE the string is ever parsed as HTML/assigned to innerHTML — this is
  // the boundary.
  DOMPurify.addHook('afterSanitizeAttributes', makeTopicSanitizeHook());
  var clean = DOMPurify.sanitize(DATA.__html, ${TOPIC_SANITIZE_CONFIG_JS});
  document.getElementById('root').innerHTML = clean;

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
