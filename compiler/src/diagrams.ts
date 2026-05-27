import { escapeHtml } from "./html";

// A diagram renderer turns a Mermaid source block into self-contained markup.
// Pluggable so the heavy implementation (mermaid-cli → inline SVG, needs Node +
// headless Chromium) can land in a later milestone behind the same seam, while
// milestones 1–3 stay dependency-free. See docs/COMPILE_PIPELINE_PLAN.md (M4).
export interface DiagramRenderer {
  /** Render a Mermaid source string to an HTML fragment. */
  render(mermaidSource: string): string;
}

// Fallback stub: keeps the diagram source verbatim inside a labelled figure.
// Produces no network/script dependency and reads as plain text in any reader.
// Used when diagram pre-rendering is off, or for a single diagram that failed
// to render.
export class PassthroughDiagramRenderer implements DiagramRenderer {
  render(mermaidSource: string): string {
    return (
      '<figure class="diagram diagram--placeholder">' +
      `<pre class="mermaid-src">${escapeHtml(mermaidSource)}</pre>` +
      "<figcaption></figcaption>" +
      "</figure>"
    );
  }
}

// Wrap a finished inline-SVG fragment in the shared diagram figure. The empty
// <figcaption> is the target for the auto-numbered "Figure N." label (CSS).
function svgFigure(svg: string): string {
  return `<figure class="diagram">${svg}<figcaption></figcaption></figure>`;
}

// Records every Mermaid source it's asked to render (so they can be rendered in
// the async pre-render pass) and meanwhile returns the passthrough placeholder,
// keeping the synchronous markdown render whole. See mermaid.ts.
export class CollectingDiagramRenderer implements DiagramRenderer {
  readonly sources = new Set<string>();
  private readonly fallback = new PassthroughDiagramRenderer();
  render(mermaidSource: string): string {
    this.sources.add(mermaidSource);
    return this.fallback.render(mermaidSource);
  }
}

// Looks up the SVG produced for each source by the async pre-render pass and
// emits it inline; falls back to the placeholder on a miss (e.g. a diagram that
// failed to render), so a single bad diagram never breaks the compile.
export class PrerenderedDiagramRenderer implements DiagramRenderer {
  private readonly fallback = new PassthroughDiagramRenderer();
  constructor(private readonly svgBySource: Map<string, string>) {}
  render(mermaidSource: string): string {
    const svg = this.svgBySource.get(mermaidSource);
    return svg ? svgFigure(svg) : this.fallback.render(mermaidSource);
  }
}
