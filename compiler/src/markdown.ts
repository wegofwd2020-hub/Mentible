import { Marked, type Tokens } from "marked";
import markedKatex from "marked-katex-extension";
import type { DiagramRenderer } from "./diagrams";
import { escapeHtml } from "./html";

// Render a markdown string to a self-contained HTML fragment with:
//  - maths pre-rendered to MathML (KaTeX, output:"mathml") — no runtime JS, no CDN
//  - ```mermaid blocks delegated to the DiagramRenderer
//  - everything else via marked (GFM tables, code, blockquotes, …)
//
// Pinned to marked@18 + katex@0.17 to match the versions the app loads from
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
      // marked@10+ renderer overrides receive the parsed token object rather
      // than positional args (was `code(code, infostring)` etc. on marked@9).
      code({ text, lang }: Tokens.Code): string {
        const language = (lang ?? "").trim().split(/\s+/)[0];
        if (language === "mermaid") return diagrams.render(text);
        return `<pre><code>${escapeHtml(text)}</code></pre>`;
      },
      // Self-close void elements so output is well-formed XHTML (EPUB3 content
      // docs are parsed as XML — a bare <br>/<hr>/<img> would break the parse).
      br(): string {
        return "<br/>";
      },
      hr(): string {
        return "<hr/>";
      },
      image({ href, title, text }: Tokens.Image): string {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}/>`;
      },
      checkbox({ checked }: Tokens.Checkbox): string {
        return `<input ${checked ? 'checked="checked" ' : ""}disabled="disabled" type="checkbox"/>`;
      },
      // Add an (empty) <caption> so the table gets an auto-numbered "Table N."
      // label (CSS counter). Otherwise mirrors marked's default table markup —
      // marked@10+ hands `table()` the raw token (header/rows of cell tokens)
      // instead of pre-rendered header/body HTML strings (marked@9 shape), so
      // header/body are rebuilt here via the (un-overridden) default
      // tablerow()/tablecell() renderer methods.
      table(token: Tokens.Table): string {
        let headerHtml = "";
        for (const cell of token.header) headerHtml += this.tablecell(cell);
        const headerRow = this.tablerow({ text: headerHtml });

        let bodyHtml = "";
        for (const row of token.rows) {
          let rowHtml = "";
          for (const cell of row) rowHtml += this.tablecell(cell);
          bodyHtml += this.tablerow({ text: rowHtml });
        }
        const tbody = bodyHtml ? `<tbody>${bodyHtml}</tbody>` : "";
        return `<table>\n<caption></caption>\n<thead>\n${headerRow}</thead>\n${tbody}</table>\n`;
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
