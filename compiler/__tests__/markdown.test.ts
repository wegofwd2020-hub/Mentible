import { renderMarkdown } from "../src/markdown";
import { PassthroughDiagramRenderer } from "../src/diagrams";
import { XMLValidator } from "fast-xml-parser";

// Regression: LLM prose frequently contains literal <br> (and sometimes <img>,
// <hr>) HTML. marked relays inline HTML verbatim, so those bare void tags reach
// the EPUB unchanged and make the XHTML chapter invalid ("mismatched tag" — a
// fatal XML parse error in EPUB3 readers / epubcheck). renderMarkdown must
// self-close them.
const D = new PassthroughDiagramRenderer();
const r = (md: string) => renderMarkdown(md, D);

describe("renderMarkdown — void-element XHTML normalisation", () => {
  it("self-closes a raw <br> the model typed as literal HTML", () => {
    const out = r("Line one<br>line two");
    expect(out).toContain("<br/>");
    expect(out).not.toMatch(/<br>/);
  });

  it("self-closes raw <img> and <hr>", () => {
    const out = r('A <img src="x.png"> and a rule<hr>done');
    expect(out).toContain('<img src="x.png"/>');
    expect(out).toContain("<hr/>");
  });

  it("is idempotent on already self-closed tags", () => {
    const out = r("a<br/>b");
    expect(out.match(/<br\s*\/>/g)?.length).toBe(1);
    expect(out).not.toMatch(/<br>/);
  });

  it("yields well-formed XML even with raw void HTML mixed into prose + a table", () => {
    const body = r('Intro<br>more<br>and <img src="y.png"> end.\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    const doc = `<div xmlns="http://www.w3.org/1999/xhtml">${body}</div>`;
    expect(XMLValidator.validate(doc, { allowBooleanAttributes: true })).toBe(true);
  });
});
