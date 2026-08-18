// Rasterize rendered KaTeX MathML to PNG for the kdp export profile (D3,
// docs/specs/kdp-clean-export-profile.md) — Kindle's MathML support is
// partial/inconsistent, so equations are replaced with an <img class="math">
// whose alt text is the original LaTeX (accessibility: a textual alternative
// replaces the MathML semantics for this profile — see epub.ts's
// accessibilityMeta() call).
//
// markdown.ts's renderMarkdown renders math via marked-katex-extension with
// output:"mathml", which emits:
//   <span class="katex"><math ...>...<annotation encoding="application/x-tex">
//     LATEX</annotation></math></span>
// KaTeX embeds the original LaTeX source itself (already XML/HTML-attribute-
// escaped), so this module reads it straight out of the rendered HTML — no
// separate LaTeX-capture plumbing through renderCore.ts/markdown.ts needed.
//
// Mirrors mermaid.ts's two-pass pattern (collectMermaidSources → batch render
// → embed): collect every unique fragment book-wide, rasterize once in one
// browser (rasterize.ts), then substitute per chapter.

import { renderTopicBody } from "./renderCore";
import { PassthroughDiagramRenderer } from "./diagrams";
import { rasterizeManyToPngResilient } from "./rasterize";
import type { Book, GeneratedTopic } from "./types";

const KATEX_SPAN = /<span class="katex">(<math[^]*?<\/math>)<\/span>/g;
const ANNOTATION = /<annotation encoding="application\/x-tex">([^]*?)<\/annotation>/;

function latexOf(mathml: string): string {
  return ANNOTATION.exec(mathml)?.[1] ?? "";
}

// Pull every rendered KaTeX MathML span out of a body-HTML string, in order.
// Returns the FULL matched span (`<span class="katex">...</span>`), not just
// the inner `<math>` — this is the exact string replaceMathWithImages keys
// its lookup on (its `full` regex-match argument), so collectMathHtml's
// output can be rasterized and substituted back with a plain string match.
export function extractMathHtml(bodyHtml: string): string[] {
  return [...bodyHtml.matchAll(KATEX_SPAN)].map((m) => m[0]);
}

// Collect every MathML fragment across all content-bearing topics, in reading
// order — a throwaway render pass (output discarded) with a passthrough
// diagram renderer, walking the same topic tree compileEpub walks for real.
export function collectMathHtml(book: Book): string[] {
  const content = book.content ?? {};
  const diagrams = new PassthroughDiagramRenderer();
  const out: string[] = [];
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const topic: GeneratedTopic | undefined = unit.id ? content[unit.id] : undefined;
      if (topic) out.push(...extractMathHtml(renderTopicBody(topic, diagrams)));
    }
  }
  return out;
}

// Rasterize every unique MathML fragment to a PNG data URI in one batch (one
// headless-Chromium browser — rasterize.ts's rasterizeManyToPngResilient).
// Keyed by the exact MathML string so replaceMathWithImages can look each one
// up per chapter. Returns an empty map (no browser launch) when there is
// nothing to rasterize.
//
// Per-item isolated: rasterizeManyToPngResilient never rejects — a fragment
// Chromium can't render (real risk: markdown.ts sets throwOnError:false for
// KaTeX, so quirky LLM-produced LaTeX reaches here already-rendered-but-odd)
// comes back `null` and is simply left OUT of the returned map, rather than
// failing the whole batch. replaceMathWithImages' existing map-miss path is
// what makes that fragment fall back to MathML — this is the real, reachable
// trigger for that fallback, not just a defensive branch.
export async function rasterizeMath(mathmlList: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(mathmlList)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const pngs = await rasterizeManyToPngResilient(unique, 500, true);
  unique.forEach((m, i) => {
    const png = pngs[i];
    if (png) out.set(m, `data:image/png;base64,${png.toString("base64")}`);
  });
  // A partial raster failure is otherwise silent: the failed fragment quietly
  // reverts to MathML (replaceMathWithImages' map-miss fallback), which is
  // exactly what the kdp profile exists to eliminate, and epubcheck can't
  // catch it (MathML is valid EPUB3). Surface it on stderr — the compiler
  // writes the EPUB bytes to stdout (-o -), so this must never be
  // console.log — so a silently-degraded Kindle book doesn't ship unnoticed.
  const missing = unique.length - out.size;
  if (missing > 0) {
    console.error(
      `[kdp] warning: ${missing} of ${unique.length} equations could not be rasterized and remain as MathML (may render poorly on Kindle)`,
    );
  }
  return out;
}

// Replace every KaTeX MathML span in a chapter's body HTML with a rasterized
// <img class="math math-inline|math-block" alt="<LaTeX>">, using the batch
// built by rasterizeMath. A fragment with no matching PNG (a raster failure)
// is left as MathML — a single bad equation never breaks the compile.
export function replaceMathWithImages(bodyHtml: string, pngByMathml: Map<string, string>): string {
  return bodyHtml.replace(KATEX_SPAN, (full: string, mathml: string) => {
    // Keyed by `full` (the entire `<span class="katex">...</span>` match) to
    // match collectMathHtml's output, which is what rasterizeMath's map is
    // built from. `mathml` (the inner `<math>` capture) is only used below to
    // pull the display mode + LaTeX out.
    const src = pngByMathml.get(full);
    if (!src) return full;
    const block = /<math[^>]*\bdisplay="block"/.test(mathml);
    const cls = block ? "math math-block" : "math math-inline";
    return `<img class="${cls}" alt="${latexOf(mathml)}" src="${src}"/>`;
  });
}
