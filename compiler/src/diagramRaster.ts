// KDP profile diagram rendering (D4, docs/specs/kdp-clean-export-profile.md):
// Kindle's SVG support is limited/no-scripting, so a pre-rendered Mermaid SVG
// (mermaid.ts's prerenderDiagrams) is rasterized to PNG instead of inlined.
// Reuses the same one-browser batch helper as mathRaster.ts/coverRaster.ts —
// no second Puppeteer integration.

import { rasterizeManyToPngResilient } from "./rasterize";
import { PassthroughDiagramRenderer, type DiagramRenderer } from "./diagrams";

// Batch-rasterize every pre-rendered Mermaid SVG to a PNG data URI in one
// browser pass. Keyed by the ORIGINAL Mermaid source, matching the SVG map it
// consumes (mermaid.ts's prerenderDiagrams output).
//
// Per-item isolated: rasterizeManyToPngResilient never rejects — a diagram
// Chromium can't rasterize (same risk class as mathRaster.ts's quirky-LaTeX
// case: mermaid.ts's own renderAll already tolerates a bad diagram by
// omitting it) comes back `null` and is simply left OUT of the returned map,
// rather than failing the whole batch. PrerenderedRasterDiagramRenderer's
// map-miss path is what makes that diagram fall back to the inline-SVG/
// placeholder figure instead of breaking the compile.
export async function rasterizeDiagramPngs(svgBySource: Map<string, string>): Promise<Map<string, string>> {
  const sources = [...svgBySource.keys()];
  const out = new Map<string, string>();
  if (sources.length === 0) return out;
  const svgs = sources.map((s) => svgBySource.get(s)!);
  const pngs = await rasterizeManyToPngResilient(svgs, 800, true);
  sources.forEach((s, i) => {
    const png = pngs[i];
    if (png) out.set(s, `data:image/png;base64,${png.toString("base64")}`);
  });
  // A partial raster failure is otherwise silent: the failed diagram quietly
  // reverts to the text placeholder (PrerenderedRasterDiagramRenderer's
  // map-miss fallback), which is exactly what the kdp profile exists to
  // eliminate, and epubcheck can't catch it. Surface it on stderr — the
  // compiler writes the EPUB bytes to stdout (-o -), so this must never be
  // console.log — so a silently-degraded Kindle book doesn't ship unnoticed.
  const missing = sources.length - out.size;
  if (missing > 0) {
    console.error(
      `[kdp] warning: ${missing} of ${sources.length} diagrams could not be rasterized and remain as placeholders (may render poorly on Kindle)`,
    );
  }
  return out;
}

function imgFigure(dataUri: string): string {
  return `<figure class="diagram"><img src="${dataUri}" alt="Diagram"/><figcaption></figcaption></figure>`;
}

// KDP variant of diagrams.ts's PrerenderedDiagramRenderer: emits a raster
// <img> instead of an inline <svg>. Falls back to the shared text placeholder
// on a raster miss (e.g. a diagram that failed to render or failed to
// rasterize), same as the SVG renderer — a single bad diagram never breaks
// the compile.
export class PrerenderedRasterDiagramRenderer implements DiagramRenderer {
  private readonly fallback = new PassthroughDiagramRenderer();
  constructor(private readonly pngBySource: Map<string, string>) {}
  render(mermaidSource: string): string {
    const dataUri = this.pngBySource.get(mermaidSource);
    return dataUri ? imgFigure(dataUri) : this.fallback.render(mermaidSource);
  }
}
