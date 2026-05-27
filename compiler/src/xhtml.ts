import { escapeHtml } from "./html";

// Wrap a rendered body fragment in a complete EPUB3 XHTML content document.
// XML declaration + html5 doctype + the XHTML and EPUB ops namespaces. MathML
// (from the render core) is valid inline in an XHTML content document.
export function xhtmlDocument(title: string, body: string, cssHref: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
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
