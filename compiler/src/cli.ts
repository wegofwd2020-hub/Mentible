#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { compileEpub } from "./epub";
import { compilePdf } from "./pdfRender";
import { compileDocx } from "./docx";
import { PuppeteerMermaidRenderer } from "./mermaid";
import { buildCoverSvgFile, coverInputForBook } from "./cover";
import { renderCoverPng } from "./coverRaster";
import { compileCard, type CardInput } from "./card";
import { compileCarousel, type CarouselInput } from "./carousel";
import type { Book } from "./types";

// compile <book.json|-> [-o out|-] [--format epub|pdf|docx|cover|card|carousel] [--mermaid]
//   input      a path, or "-" / omitted to read book JSON from stdin
//   -o         a path, or "-" to write to stdout (default when reading stdin)
//   --format   epub (default) | pdf (Vivliostyle textbook layout) |
//              docx (Word) | cover (a PNG thumbnail of the book's cover, for
//              the Library) | card (a branded quote/summary PNG card, for
//              Publish — reads a CardInput JSON on stdin, not a Book) |
//              carousel (N branded PNG card frames, one Chromium pass — reads
//              a CarouselInput JSON on stdin, emits {png_base64: string[]})
//   --mermaid  render diagrams to inline SVG (needs a headless browser); else
//              diagrams fall back to a readable text placeholder.

type Format = "epub" | "pdf" | "cover" | "docx" | "card" | "carousel";

function parseArgs(argv: string[]): {
  input?: string;
  output?: string;
  mermaid: boolean;
  format: Format;
} {
  let input: string | undefined;
  let output: string | undefined;
  let mermaid = false;
  let format: Format = "epub";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mermaid") mermaid = true;
    else if (a === "--format") {
      const f = argv[++i];
      format =
        f === "pdf"
          ? "pdf"
          : f === "cover"
            ? "cover"
            : f === "docx"
              ? "docx"
              : f === "card"
                ? "card"
                : f === "carousel"
                  ? "carousel"
                  : "epub";
    } else if (a === "--pdf") format = "pdf";
    else if (a === "-o") output = argv[++i];
    else if (!input) input = a;
  }
  return { input, output, mermaid, format };
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const { input, output, mermaid, format } = parseArgs(process.argv.slice(2));

  const fromStdin = !input || input === "-";
  const raw = fromStdin ? (await readStdin()).toString("utf8") : readFileSync(input, "utf8");

  if (format === "card") {
    const out = await compileCard(JSON.parse(raw) as CardInput);
    process.stdout.write(Buffer.from(out));
    return;
  }

  if (format === "carousel") {
    const out = await compileCarousel(JSON.parse(raw) as CarouselInput);
    process.stdout.write(out);
    return;
  }

  const book = JSON.parse(raw) as Book;

  const mermaidOpt = mermaid ? { mermaid: new PuppeteerMermaidRenderer() } : {};
  const out =
    format === "pdf"
      ? await compilePdf(book, mermaidOpt)
      : format === "cover"
        ? await renderCoverPng(buildCoverSvgFile(coverInputForBook(book)))
        : format === "docx"
          ? await compileDocx(book)
          : await compileEpub(book, mermaidOpt);

  // Write to stdout when asked, or by default when input came from stdin.
  const toStdout = output === "-" || (fromStdin && !output);
  if (toStdout) {
    process.stdout.write(Buffer.from(out));
  } else {
    const outPath = output ?? (input as string).replace(/\.json$/i, "") + "." + format;
    writeFileSync(outPath, out);
    process.stderr.write(
      `wrote ${outPath} (${out.length} bytes, ${book.title}, ${format})${mermaid ? " [diagrams: SVG]" : ""}\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
