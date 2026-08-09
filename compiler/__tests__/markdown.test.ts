import { renderMarkdown } from "../src/markdown";
import { PassthroughDiagramRenderer, type DiagramRenderer } from "../src/diagrams";
import { XMLValidator } from "fast-xml-parser";

// Regression: LLM prose frequently contains literal <br> (and sometimes <img>,
// <hr>) HTML. marked relays inline HTML verbatim, so those bare void tags reach
// the EPUB unchanged and make the XHTML chapter invalid ("mismatched tag" — a
// fatal XML parse error in EPUB3 readers / epubcheck). renderMarkdown must
// self-close them.
const D = new PassthroughDiagramRenderer();
const r = (md: string) => renderMarkdown(md, D);

describe("renderMarkdown — ```svg blocks", () => {
  it("inlines a ```svg fence as a <figure class=\"anim-svg\"> (not <pre><code>, not escaped)", () => {
    const out = r("```svg\n<svg><rect/></svg>\n```");
    expect(out).toContain('<figure class="anim-svg">');
    // DOMPurify sanitizes by parsing + re-serializing the DOM, so the exact
    // self-closing byte form isn't preserved (<rect/> -> <rect></rect>) —
    // assert the element survives, not its exact serialization.
    expect(out).toMatch(/<svg[^>]*>[\s\S]*<rect[\s\S]*<\/svg>/);
    expect(out).not.toContain("<pre><code>");
    expect(out).not.toContain("&lt;svg&gt;");
  });

  it("strips a <script> embedded in the svg body", () => {
    const out = r('```svg\n<svg><script>alert(1)</script><rect/></svg>\n```');
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("alert(1)");
  });

  it("strips an on* event handler attribute (XSS via headless-Chromium PDF render)", () => {
    const out = r('```svg\n<svg onload="alert(1)"><rect/></svg>\n```');
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).not.toContain("onload");
    expect(out).not.toContain("alert(1)");
  });

  it("strips a javascript: href (XSS via headless-Chromium PDF render)", () => {
    const out = r(
      '```svg\n<svg><a href="javascript:alert(1)"><rect/></a></svg>\n```',
    );
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("alert(1)");
  });

  it("leaves no executable trace of an unclosed <script token", () => {
    const out = r('```svg\n<svg><script>alert(1)<rect/></svg>\n```');
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("preserves a clean svg body's element + attributes inside the figure", () => {
    const out = r("```svg\n<svg><rect width=\"10\" height=\"10\"/></svg>\n```");
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).toContain("<rect");
    expect(out).toContain('width="10"');
    expect(out).toContain('height="10"');
  });

  it("still delegates ```mermaid blocks to the DiagramRenderer (unchanged)", () => {
    const spy: DiagramRenderer = { render: jest.fn(() => "<!--DIAGRAM-->") };
    const out = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```", spy);
    expect(spy.render).toHaveBeenCalledWith("graph TD; A-->B;");
    expect(out).toContain("<!--DIAGRAM-->");
  });

  it("still renders a plain/unknown fence as <pre><code>, escaped (unchanged)", () => {
    const out = r("```js\nconst x = 1 < 2;\n```");
    expect(out).toContain("<pre><code>");
    expect(out).toContain("1 &lt; 2");
  });
});

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
