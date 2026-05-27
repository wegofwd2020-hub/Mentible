#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { compileEpub } from "./epub";
import { MermaidCliRenderer } from "./mermaid";
import type { Book } from "./types";

// compile-epub <book.json|-> [-o out.epub|-] [--mermaid]
//   input   a path, or "-" / omitted to read book JSON from stdin
//   -o      a path, or "-" to write the EPUB to stdout (default when reading
//           from stdin) — lets a server pipe in/out without touching disk
//   --mermaid  render diagrams to inline SVG via @mermaid-js/mermaid-cli
//              (needs headless Chromium; install it in compiler/). Without it,
//              diagrams fall back to a readable text placeholder.

function parseArgs(argv: string[]): { input?: string; output?: string; mermaid: boolean } {
  let input: string | undefined;
  let output: string | undefined;
  let mermaid = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mermaid") mermaid = true;
    else if (a === "-o") output = argv[++i];
    else if (!input) input = a;
  }
  return { input, output, mermaid };
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const { input, output, mermaid } = parseArgs(process.argv.slice(2));

  const fromStdin = !input || input === "-";
  const raw = fromStdin ? (await readStdin()).toString("utf8") : readFileSync(input, "utf8");
  const book = JSON.parse(raw) as Book;

  const epub = await compileEpub(book, mermaid ? { mermaid: new MermaidCliRenderer() } : {});

  // Write to stdout when asked, or by default when input came from stdin.
  const toStdout = output === "-" || (fromStdin && !output);
  if (toStdout) {
    process.stdout.write(Buffer.from(epub));
  } else {
    const outPath = output ?? (input as string).replace(/\.json$/i, "") + ".epub";
    writeFileSync(outPath, epub);
    process.stderr.write(
      `wrote ${outPath} (${epub.length} bytes, ${book.title})${mermaid ? " [diagrams: SVG]" : ""}\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
