// Compile a Book to a .docx (OOXML) via the `docx` library — the pure-JS
// alternative export alongside EPUB3/PDF. Prose comes from marked's block/
// inline token tree (same lexer markdown.ts uses); math and Mermaid diagrams
// are rasterized to PNG via the shared rasterize.ts/mermaid.ts paths and
// embedded as images. Sources needs no special handling — topicsToBook
// already emits it as an ordinary topic, so this just walks every topic's
// lesson.sections in TOC order.
//
// Every rasterize call is isolated in its own try/catch: a failed screenshot
// (most commonly puppeteer simply not being installed — it's an optional,
// non-committed dep, see rasterize.ts) degrades to a monospace text run of
// the original source instead of failing the whole document.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from "docx";
import { Marked, type Token, type Tokens } from "marked";
import markedKatex from "marked-katex-extension";
import { rasterizeToPng } from "./rasterize";
import { PuppeteerMermaidRenderer } from "./mermaid";
import type { Book, GeneratedTopic } from "./types";

// KaTeX HTML → PNG. Renders the expression in a KaTeX-styled shell and
// screenshots it. `katex` is already a compiler dep (see markdown.ts). No
// stylesheet is inlined here — the raw KaTeX markup still rasterizes fine
// without it, and importing katex/dist/katex.min.css as a string is not
// reliably resolvable under ts-jest, so keep the styling best-effort rather
// than let it block the build (rasterizeToPng already fails clean when
// puppeteer itself is absent, which the try/catch below turns into a
// text fallback either way).
async function mathPng(tex: string, display: boolean): Promise<Buffer | null> {
  try {
    const katex = (await import("katex")).default;
    const html = katex.renderToString(tex, { throwOnError: false, displayMode: display, output: "html" });
    return await rasterizeToPng({
      html: `<span class="katex-shell">${html}</span>`,
      width: display ? 480 : 240,
      omitBackground: true,
    });
  } catch {
    return null;
  }
}

async function mermaidPng(source: string): Promise<Buffer | null> {
  try {
    const map = await new PuppeteerMermaidRenderer().renderAll([source]);
    const svg = map.get(source);
    if (!svg) return null;
    return await rasterizeToPng({ svg, width: 560, omitBackground: true });
  } catch {
    return null;
  }
}

// Minimal inline mapping: bold/italic/code/plain (+ links flattened to their
// label text). `tokens` is marked's inline token array for a paragraph/list
// item; any token type this doesn't specially handle (including
// `inlineKatex`, which marked-katex-extension emits at the inline level)
// falls through to the `default` branch, which renders its `.text` as a
// plain run — so inline math always degrades safely to its raw/rendered
// source text rather than being dropped or throwing.
function runsFromInline(tokens: Token[] | undefined, text: string): TextRun[] {
  if (!tokens) return [new TextRun(text)];
  const out: TextRun[] = [];
  const walk = (t: Token, bold = false, italics = false): void => {
    switch (t.type) {
      case "strong":
        (t as Tokens.Strong).tokens.forEach((c) => walk(c, true, italics));
        break;
      case "em":
        (t as Tokens.Em).tokens.forEach((c) => walk(c, bold, true));
        break;
      case "codespan":
        out.push(new TextRun({ text: (t as Tokens.Codespan).text, font: "Courier New", bold, italics }));
        break;
      case "link":
        (t as Tokens.Link).tokens.forEach((c) => walk(c, bold, italics));
        break;
      default: {
        const raw = (t as { text?: string }).text ?? "";
        if (raw) out.push(new TextRun({ text: raw, bold, italics }));
      }
    }
  };
  tokens.forEach((t) => walk(t));
  return out.length ? out : [new TextRun(text)];
}

async function imageParagraph(png: Buffer | null, fallback: string): Promise<Paragraph> {
  return png
    ? new Paragraph({
        children: [new ImageRun({ data: png, transformation: { width: 300, height: 120 }, type: "png" })],
      })
    : new Paragraph({ children: [new TextRun({ text: fallback, font: "Courier New" })] });
}

async function blocksFromMarkdown(md: string): Promise<Paragraph[]> {
  const m = new Marked();
  m.use(markedKatex({ throwOnError: false, strict: false, output: "html" }));
  const tokens = m.lexer(md);
  const paras: Paragraph[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        paras.push(new Paragraph({ text: (t as Tokens.Heading).text, heading: HeadingLevel.HEADING_3 }));
        break;
      case "paragraph":
        paras.push(
          new Paragraph({ children: runsFromInline((t as Tokens.Paragraph).tokens, (t as Tokens.Paragraph).text) }),
        );
        break;
      case "list":
        for (const item of (t as Tokens.List).items) {
          paras.push(new Paragraph({ children: runsFromInline(item.tokens, item.text), bullet: { level: 0 } }));
        }
        break;
      case "code": {
        const lang = ((t as Tokens.Code).lang ?? "").trim().split(/\s+/)[0];
        if (lang === "mermaid") {
          paras.push(await imageParagraph(await mermaidPng((t as Tokens.Code).text), (t as Tokens.Code).text));
        } else {
          paras.push(new Paragraph({ children: [new TextRun({ text: (t as Tokens.Code).text, font: "Courier New" })] }));
        }
        break;
      }
      case "blockKatex": {
        const katexTok = t as unknown as { text: string; displayMode?: boolean };
        const tex = katexTok.text;
        const display = katexTok.displayMode ?? true;
        paras.push(await imageParagraph(await mathPng(tex, display), `$$${tex}$$`));
        break;
      }
      case "blockquote":
        for (const child of (t as Tokens.Blockquote).tokens) {
          if (child.type === "paragraph") {
            paras.push(
              new Paragraph({
                children: runsFromInline((child as Tokens.Paragraph).tokens, (child as Tokens.Paragraph).text),
                indent: { left: 360 },
              }),
            );
          }
        }
        break;
      default:
        // Plain/space/hr and anything else with a `.text` renders as a plain
        // run; tokens with no text (hr, space) are skipped.
        if ((t as { text?: string }).text) {
          paras.push(new Paragraph({ children: [new TextRun((t as { text: string }).text)] }));
        }
    }
  }
  return paras;
}

export async function compileDocx(book: Book): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: book.title, heading: HeadingLevel.TITLE })];
  const content = book.content ?? {};
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const topic: GeneratedTopic | undefined = unit.id ? content[unit.id] : undefined;
      if (!topic) continue;
      children.push(new Paragraph({ text: topic.title, heading: HeadingLevel.HEADING_1 }));
      for (const s of topic.lesson.sections) {
        if (s.heading) children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }));
        children.push(...(await blocksFromMarkdown(s.body_markdown)));
      }
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
