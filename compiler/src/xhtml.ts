import { escapeHtml } from "./html";

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
// of the body here, in the one place all of them funnel through.
export function xhtmlDocument(
  title: string,
  body: string,
  cssHref: string,
  lang = "en",
  profile: "default" | "kdp" | "epub2" = "default",
): string {
  const l = escapeHtml(lang);
  if (profile === "epub2") {
    const stripped = body.replace(/\sepub:type="[^"]*"/g, "");
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${l}" lang="${l}">
<head>
<meta charset="utf-8"/>
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
