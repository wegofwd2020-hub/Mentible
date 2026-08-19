import { escapeHtml } from "./html";

// EPUB2 (D2, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md,
// ADR-041 Initiative A, fix round 1 bucket 2): the XHTML 1.1 Strict DTD's
// block content model is `address|blockquote|del|div|dl|h1..h6|hr|ins|
// noscript|ns:svg|ol|p|pre|script|table|ul` — no <section>, <figure>, or
// <figcaption> (all HTML5-only, with no XHTML1.1 equivalent element). Rather
// than fork every body-fragment builder (colophon.ts, diagrams.ts, floats.ts,
// diagramRaster.ts, the topic-audio <figure> that survives stripAudioElements
// in epub.ts, …) into a profile-aware variant, downgrade is a single
// post-process over the assembled body string: rename the element, folding
// the original tag name into `class` (merged with any existing class="…") so
// css.ts's `.section`/`.figure`/`.figcaption` selectors keep matching
// identical rendered markup across every profile. figure/figcaption map to
// div/p (figcaption is textual — <p> is the closer DTD-legal fit). None of
// these three ever nest same-tag-in-same-tag in our output, so simple global
// open/close regexes (no nesting-depth tracking needed) are exact.
const XHTML11_DOWNGRADES: { tag: string; as: "div" | "p"; cls: string }[] = [
  { tag: "section", as: "div", cls: "section" },
  { tag: "figure", as: "div", cls: "figure" },
  { tag: "figcaption", as: "p", cls: "figcaption" },
];

export function downgradeToXhtml11(html: string): string {
  let out = html;
  for (const { tag, as, cls } of XHTML11_DOWNGRADES) {
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, "gi"), (_full, attrs?: string) => {
      const rest = (attrs ?? "").trim();
      const classMatch = /class="([^"]*)"/.exec(rest);
      const attrsOut = classMatch
        ? rest.replace(/class="[^"]*"/, `class="${cls} ${classMatch[1]}"`)
        : `class="${cls}"${rest ? ` ${rest}` : ""}`;
      return `<${as} ${attrsOut}>`;
    });
    out = out.replace(new RegExp(`</${tag}>`, "gi"), `</${as}>`);
  }
  return out;
}

// Wrap a rendered body fragment in a complete EPUB content document.
//
// default/kdp (EPUB3): XML declaration + html5 doctype + the XHTML and EPUB
// ops namespaces. MathML (from the render core) is valid inline here.
//
// epub2 (D3, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md,
// ADR-041 Initiative A): EPUB 2 content is XHTML 1.1, not HTML5 — the XHTML
// 1.1 DOCTYPE replaces the html5 one, and there is no xmlns:epub namespace
// (EPUB3's "ops" vocabulary doesn't exist in EPUB2). Callers (titleXhtml,
// colophonSection, glossaryDoc) build one shared body fragment for every
// profile and that fragment carries `epub:type="…"` attributes — rather than
// forking each caller, xhtmlDocument strips any `epub:type="…"` attribute out
// of the body here, in the one place all of them funnel through — and (fix
// round 1 bucket 2) runs downgradeToXhtml11 on what's left, so this is also
// the ONE place every epub2 content document (chapters included — the
// per-topic loop in epub.ts routes chapter bodies through this same
// function) gets its HTML5 structural elements downgraded. Bucket 3: the
// HTML5 `<meta charset>` shorthand isn't legal XHTML 1.1 either — swap it for
// the `http-equiv` form.
export function xhtmlDocument(
  title: string,
  body: string,
  cssHref: string,
  lang = "en",
  profile: "default" | "kdp" | "epub2" = "default",
): string {
  const l = escapeHtml(lang);
  if (profile === "epub2") {
    const stripped = downgradeToXhtml11(body.replace(/\sepub:type="[^"]*"/g, ""));
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${l}" lang="${l}">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="${escapeHtml(cssHref)}"/>
</head>
<body>
${stripped}
</body>
</html>
`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${l}" lang="${l}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="${escapeHtml(cssHref)}"/>
</head>
<body>
${body}
</body>
</html>
`;
}
