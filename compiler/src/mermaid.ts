import { renderTopicBody } from "./renderCore";
import { CollectingDiagramRenderer } from "./diagrams";
import type { Book, GeneratedTopic } from "./types";

// Async Mermaid → SVG rendering (milestone 4 + perf). Mermaid needs a DOM, so a
// headless browser does the work — but ONE browser renders ALL diagrams via the
// Mermaid JS API (mermaid.render), instead of spawning a fresh Chromium per
// diagram. That turns a minutes-long, 100-diagram book into tens of seconds.
//
// Heavy + OPTIONAL (own headless browser), kept out of the default path; the
// CLI opts in with --mermaid.
export interface MermaidRenderer {
  /** Render many Mermaid sources to SVG in one pass. A source that fails to
   *  render is omitted from the map (the caller falls back to a placeholder). */
  renderAll(sources: readonly string[]): Promise<Map<string, string>>;
}

// Strip any XML prolog / DOCTYPE so the <svg> root can be inlined into XHTML.
export function extractSvg(raw: string): string {
  const i = raw.indexOf("<svg");
  return i >= 0 ? raw.slice(i).trim() : raw.trim();
}

// Preserve a native dynamic import (CJS build importing ESM packages that aren't
// committed deps; also dodges compile-time module resolution).
const nativeImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;

// Resolve a package file path without a static specifier (puppeteer/mermaid are
// installed only in the image, not the committed package.json).
function resolvePath(spec: string): string {
  return require.resolve(spec);
}

interface MermaidConfig {
  theme: string;
  securityLevel: string;
  flowchart: { htmlLabels: boolean };
  startOnLoad: boolean;
}

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "strict",
  flowchart: { htmlLabels: false }, // keep SVG XML-clean (no foreignObject HTML)
};

// One headless browser, the local Mermaid bundle injected once, then every
// diagram rendered in the same page.
export class PuppeteerMermaidRenderer implements MermaidRenderer {
  async renderAll(sources: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (sources.length === 0) return out;

    let puppeteer: { launch: (opts: Record<string, unknown>) => Promise<PuppeteerBrowser> };
    let mermaidDist: string;
    try {
      const mod = (await nativeImport("puppeteer")) as { default?: typeof puppeteer; launch?: unknown };
      puppeteer = (mod.default ?? mod) as typeof puppeteer;
      mermaidDist = resolvePath("mermaid/dist/mermaid.min.js");
    } catch {
      throw new Error(
        "puppeteer + mermaid are not installed. Run `npm install puppeteer mermaid` in " +
          "compiler/ to render diagrams (needs a headless browser).",
      );
    }

    const launch: Record<string, unknown> = { headless: true };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launch.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    launch.args =
      process.env.SBQ_NO_SANDBOX === "1"
        ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        : [];

    const browser = await puppeteer.launch(launch);
    try {
      const page = await browser.newPage();
      await page.setContent("<!DOCTYPE html><html><body></body></html>");
      await page.addScriptTag({ path: mermaidDist });
      await page.evaluate((cfg: MermaidConfig) => {
        (globalThis as unknown as { mermaid: { initialize: (c: unknown) => void } }).mermaid.initialize(cfg);
      }, MERMAID_CONFIG);

      let i = 0;
      for (const source of sources) {
        i += 1;
        try {
          const svg = (await page.evaluate(
            async (code: string, id: string) => {
              const m = (globalThis as unknown as {
                mermaid: { render: (id: string, t: string) => Promise<{ svg: string }> };
              }).mermaid;
              return (await m.render(id, code)).svg;
            },
            source,
            `sbq-d${i}`,
          )) as string;
          out.set(source, extractSvg(svg));
        } catch {
          // leave unset → placeholder fallback
        }
      }
    } finally {
      await browser.close();
    }
    return out;
  }
}

interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}
interface PuppeteerPage {
  setContent(html: string): Promise<void>;
  addScriptTag(opts: { path: string }): Promise<unknown>;
  evaluate(fn: (...args: never[]) => unknown, ...args: unknown[]): Promise<unknown>;
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

// Pre-render every unique diagram to SVG in one batch.
export async function prerenderDiagrams(
  book: Book,
  renderer: MermaidRenderer,
): Promise<Map<string, string>> {
  return renderer.renderAll(collectMermaidSources(book));
}
