import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import type { DiagramRenderer } from "./diagrams";
import { escapeHtml } from "./html";

// Render a markdown string to a self-contained HTML fragment with:
//  - maths pre-rendered to MathML (KaTeX, output:"mathml") — no runtime JS, no CDN
//  - ```mermaid blocks delegated to the DiagramRenderer
//  - everything else via marked (GFM tables, code, blockquotes, …)
//
// Pinned to marked@9.1.6 + katex@0.16.9 to match the versions the app loads from
// CDN in mobile/src/components/contentHtml.ts, so artifact output tracks the
// in-app preview.
//
// A fresh Marked instance per call keeps the diagram closure isolated and avoids
// shared global renderer state.
export function renderMarkdown(md: string | null | undefined, diagrams: DiagramRenderer): string {
  const m = new Marked();
  // strict:false — render best-effort and don't warn on quirks in LLM-authored
  // LaTeX (e.g. a stray en-dash inside math); throwOnError:false keeps a bad
  // expression from failing the whole compile.
  m.use(markedKatex({ throwOnError: false, strict: false, output: "mathml" }));
  m.use({
    renderer: {
      code(code: string, infostring: string | undefined): string {
        const lang = (infostring ?? "").trim().split(/\s+/)[0];
        if (lang === "mermaid") return diagrams.render(code);
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      },
      // Self-close void elements so output is well-formed XHTML (EPUB3 content
      // docs are parsed as XML — a bare <br>/<hr>/<img> would break the parse).
      br(): string {
        return "<br/>";
      },
      hr(): string {
        return "<hr/>";
      },
      image(href: string | null, title: string | null, text: string): string {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}/>`;
      },
      checkbox(checked: boolean): string {
        return `<input ${checked ? 'checked="checked" ' : ""}disabled="disabled" type="checkbox"/>`;
      },
      // Add an (empty) <caption> so the table gets an auto-numbered "Table N."
      // label (CSS counter). Mirrors marked@9's default table markup otherwise.
      table(header: string, body: string): string {
        const tbody = body ? `<tbody>${body}</tbody>` : "";
        return `<table>\n<caption></caption>\n<thead>\n${header}</thead>\n${tbody}</table>\n`;
      },
    },
  });
  const html = m.parse(md ?? "", { async: false }) as string;
  // Self-close every void element in the FINAL html — crucially the raw
  // <br>/<img>/<hr> that LLM prose passes through verbatim. marked relays inline
  // HTML as-is, so the br()/hr()/image() renderer overrides above only cover the
  // markdown-*syntax* cases; a literal "<br>" the model typed slips straight
  // through. EPUB3 content docs are parsed as XML, where a bare <br> is a fatal
  // "mismatched tag" error — so normalise here. Idempotent on already-closed tags.
  return html.replace(
    /(<(?:br|hr|img|input|col|area|base|embed|source|track|wbr|meta|link)\b[^>]*?)\s*\/?>/gi,
    "$1/>",
  );
}
