/**
 * @jest-environment jsdom
 */
import { md, escapeHtml, li, stripDupHeading } from "@/reader/markdown";

describe("escapeHtml", () => {
  it("escapes the characters that could break out of markup", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
  it("renders null and undefined as empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("li", () => {
  it("escapes each item", () => {
    expect(li(["<script>", "b"])).toBe("<li>&lt;script&gt;</li><li>b</li>");
  });
  it("handles a missing list", () => {
    expect(li(undefined)).toBe("");
  });
});

describe("stripDupHeading", () => {
  it("drops a leading heading that repeats the section heading", () => {
    expect(stripDupHeading("## Why It Matters\n\nBody.", "Why it matters")).toBe("\nBody.");
  });
  it("keeps a leading heading that differs", () => {
    expect(stripDupHeading("## Something Else\n\nBody.", "Why it matters")).toContain("Something Else");
  });
  it("handles a missing body", () => {
    expect(stripDupHeading(undefined, "h")).toBe("");
  });
});

describe("md — prose", () => {
  it("renders markdown to html", () => {
    expect(md("**bold**")).toContain("<strong>bold</strong>");
  });
  it("renders GFM tables", () => {
    expect(md("| a |\n| - |\n| 1 |")).toContain("<table>");
  });
  it("leaves math delimiters untouched for the KaTeX post-pass", () => {
    expect(md("$$E = mc^2$$")).toContain("$$E = mc^2$$");
  });
  it("renders an empty/undefined body as empty string", () => {
    expect(md(undefined)).toBe("");
  });
});

describe("md — mermaid fences", () => {
  it("emits a .mermaid div for the lazy Mermaid pass", () => {
    expect(md("```mermaid\ngraph TD;\nA-->B\n```")).toContain('<div class="mermaid">');
  });

  // Spec D4: the mermaid SOURCE is untrusted. It must sit in the DOM as inert,
  // escaped text until Mermaid parses it. Mermaid reads textContent, which
  // un-escapes, so escaping does not break diagram rendering.
  it("escapes the mermaid source so it is inert until Mermaid renders it", () => {
    const out = md('```mermaid\ngraph TD;\nA-->B\n<img src=x onerror=alert(1)>\n```');
    expect(out).toContain("&lt;img");
    expect(out).not.toMatch(/<img/i);
  });
});

describe("md — svg fences", () => {
  it("emits the svg inline inside a figure so it can animate", () => {
    const out = md('```svg\n<svg viewBox="0 0 10 10"><circle r="2"/></svg>\n```');
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).toContain("<svg");
  });

  // md() does NOT sanitize — renderContent's single final pass does (Task 4).
  // This asserts the fence is passed through raw, so the sanitizer sees it.
  it("passes svg through raw for the single final sanitize pass", () => {
    expect(md('```svg\n<svg onload="alert(1)"></svg>\n```')).toContain("onload");
  });
});

describe("md — ordinary code fences", () => {
  it("escapes code so it renders as text, not markup", () => {
    const out = md("```js\nvar x = '<b>';\n```");
    expect(out).toContain("&lt;b&gt;");
    expect(out).not.toContain("<b>");
  });
});
