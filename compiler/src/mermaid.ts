import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTopicBody } from "./renderCore";
import { CollectingDiagramRenderer } from "./diagrams";
import type { Book, GeneratedTopic } from "./types";

// Async Mermaid → SVG rendering (milestone 4). Mermaid needs a DOM, so the only
// real options are a headless browser or an external service — this is the
// heaviest dependency in the pipeline. It is therefore:
//   * async (the markdown render is sync → we pre-render in a separate pass),
//   * pluggable behind this interface, and
//   * OFF by default; the CLI opts in with --mermaid.
export interface MermaidRenderer {
  renderToSvg(source: string): Promise<string>;
}

// Strip any XML prolog / DOCTYPE so the <svg> root can be inlined into an XHTML
// content document.
export function extractSvg(raw: string): string {
  const i = raw.indexOf("<svg");
  return i >= 0 ? raw.slice(i).trim() : raw.trim();
}

// Preserve a *native* dynamic import: this file is compiled to CommonJS, but
// @mermaid-js/mermaid-cli is ESM-only, and a plain import() would be downleveled
// to require() (which can't load ESM). Going through the Function constructor
// keeps a real import() at runtime and avoids a compile-time module-resolution
// error for a package that isn't a committed dependency.
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ run: MermaidCliRun }>;

type MermaidCliRun = (
  input: string,
  output: `${string}.svg`,
  opts?: Record<string, unknown>,
) => Promise<unknown>;

// Real renderer backed by @mermaid-js/mermaid-cli (Puppeteer + headless
// Chromium). NOT a committed dependency — install it where you need diagrams:
//   cd compiler && npm install @mermaid-js/mermaid-cli
export class MermaidCliRenderer implements MermaidRenderer {
  async renderToSvg(source: string): Promise<string> {
    let run: MermaidCliRun;
    try {
      ({ run } = await nativeImport("@mermaid-js/mermaid-cli"));
    } catch {
      throw new Error(
        "@mermaid-js/mermaid-cli is not installed. Run `npm install @mermaid-js/mermaid-cli` " +
          "in compiler/ to render diagrams (needs headless Chromium).",
      );
    }
    const dir = await mkdtemp(join(tmpdir(), "sbq-mmd-"));
    const inPath = join(dir, "in.mmd");
    const outPath = join(dir, "out.svg") as `${string}.svg`;
    try {
      await writeFile(inPath, source, "utf8");
      // In a container, point Puppeteer at the system Chromium and drop the
      // sandbox (env-driven so local dev keeps the defaults).
      const puppeteerConfig: Record<string, unknown> = {};
      const chromium = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (chromium) puppeteerConfig.executablePath = chromium;
      if (process.env.SBQ_NO_SANDBOX === "1") {
        puppeteerConfig.args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
      }
      await run(inPath, outPath, {
        quiet: true,
        puppeteerConfig,
        parseMMDOptions: {
          // htmlLabels:false keeps the SVG XML-clean (no foreignObject HTML);
          // strict security disables embedded scripts; neutral theme reads on
          // paper and in light readers.
          mermaidConfig: {
            theme: "neutral",
            securityLevel: "strict",
            flowchart: { htmlLabels: false },
          },
        },
      });
      return extractSvg(await readFile(outPath, "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

// Collect unique Mermaid sources across all content-bearing topics, in reading
// order. Reuses the real render path (with a collecting renderer) so we capture
// exactly the blocks the compiler will ask to render — no separate extractor.
export function collectMermaidSources(book: Book): string[] {
  const collector = new CollectingDiagramRenderer();
  const content = book.content ?? {};
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const topic: GeneratedTopic | undefined = unit.id ? content[unit.id] : undefined;
      if (topic) renderTopicBody(topic, collector);
    }
  }
  return [...collector.sources];
}

// Pre-render every unique diagram to SVG. A diagram that fails to render is left
// unset (the PrerenderedDiagramRenderer falls back to the placeholder) rather
// than failing the whole compile.
export async function prerenderDiagrams(
  book: Book,
  renderer: MermaidRenderer,
): Promise<Map<string, string>> {
  const svgBySource = new Map<string, string>();
  for (const source of collectMermaidSources(book)) {
    try {
      svgBySource.set(source, await renderer.renderToSvg(source));
    } catch {
      // leave unset → placeholder fallback
    }
  }
  return svgBySource;
}
