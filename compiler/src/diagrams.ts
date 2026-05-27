import { escapeHtml } from "./html";

// A diagram renderer turns a Mermaid source block into self-contained markup.
// Pluggable so the heavy implementation (mermaid-cli → inline SVG, needs Node +
// headless Chromium) can land in a later milestone behind the same seam, while
// milestones 1–3 stay dependency-free. See docs/COMPILE_PIPELINE_PLAN.md (M4).
export interface DiagramRenderer {
  /** Render a Mermaid source string to an HTML fragment. */
  render(mermaidSource: string): string;
}

// Milestone-1 stub: keeps the diagram source verbatim inside a labelled figure.
// Produces no network/script dependency and renders as readable text in any
// reader; milestone 4 swaps this for real inline SVG.
export class PassthroughDiagramRenderer implements DiagramRenderer {
  render(mermaidSource: string): string {
    return (
      '<figure class="diagram diagram--placeholder">' +
      `<pre class="mermaid-src">${escapeHtml(mermaidSource)}</pre>` +
      "<figcaption>diagram (rendered at build time in a later step)</figcaption>" +
      "</figure>"
    );
  }
}
