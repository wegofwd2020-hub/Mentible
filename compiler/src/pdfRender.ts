import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { buildPdfHtml } from "./pdf";
import { PrerenderedDiagramRenderer, type DiagramRenderer } from "./diagrams";
import { prerenderDiagrams, type MermaidRenderer } from "./mermaid";
import type { Book } from "./types";

// Render the textbook HTML (pdf.ts) to a PDF. Vivliostyle is the engine — a CSS
// Paged Media typesetter that resolves the page-numbered TOC (target-counter).
// Like the Mermaid renderer it's a heavy, OPTIONAL tool (its own headless
// browser) kept behind this interface and off the default path.
export interface PdfRenderer {
  renderToPdf(html: string): Promise<Uint8Array>;
}

// Resolve the @vivliostyle/cli bin without a static module specifier (so tsc
// doesn't require it at compile time and CI stays light).
function vivliostyleBin(): string {
  const pkg = "@vivliostyle/cli";
  const pkgJson = require.resolve(`${pkg}/package.json`);
  // bin is "vivliostyle" → its script path, relative to the package dir.
  const meta = require(pkgJson) as { bin?: string | Record<string, string> };
  const rel = typeof meta.bin === "string" ? meta.bin : (meta.bin?.vivliostyle ?? "dist/cli.js");
  return join(pkgJson, "..", rel);
}

export class VivliostyleRenderer implements PdfRenderer {
  async renderToPdf(html: string): Promise<Uint8Array> {
    let bin: string;
    try {
      bin = vivliostyleBin();
    } catch {
      throw new Error(
        "@vivliostyle/cli is not installed. Run `npm install @vivliostyle/cli` in compiler/ " +
          "to render PDFs (needs a headless browser).",
      );
    }
    const dir = await mkdtemp(join(tmpdir(), "sbq-pdf-"));
    const inPath = join(dir, "index.html");
    const outPath = join(dir, "out.pdf");
    try {
      await writeFile(inPath, html, "utf8");
      await runVivliostyle(bin, inPath, outPath);
      return await readFile(outPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function runVivliostyle(bin: string, input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Generous timeout — large textbooks paginate to hundreds of pages.
    // (Container Chromium sandbox is handled at the image layer, not here.)
    const args = [bin, "build", input, "-o", output, "--log-level", "silent", "-t", "600"];
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`vivliostyle exited ${code}: ${err.slice(0, 500)}`)),
    );
  });
}

export interface CompilePdfOptions {
  diagrams?: DiagramRenderer;
  mermaid?: MermaidRenderer; // pre-render diagrams to SVG before laying out
  pdf?: PdfRenderer; // override the engine (tests inject a fake)
}

// Compile a book to a textbook PDF: pre-render diagrams (if requested), build
// the paged HTML, and render it. Mirrors compileEpub's option shape.
export async function compilePdf(book: Book, opts: CompilePdfOptions = {}): Promise<Uint8Array> {
  let diagrams = opts.diagrams;
  if (opts.mermaid) {
    diagrams = new PrerenderedDiagramRenderer(await prerenderDiagrams(book, opts.mermaid));
  }
  const html = buildPdfHtml(book, { diagrams });
  const renderer = opts.pdf ?? new VivliostyleRenderer();
  return renderer.renderToPdf(html);
}
