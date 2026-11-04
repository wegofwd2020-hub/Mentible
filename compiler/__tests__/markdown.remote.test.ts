import { renderMarkdown } from "../src/markdown";
import { PassthroughDiagramRenderer } from "../src/diagrams";

const render = (md: string) => renderMarkdown(md, new PassthroughDiagramRenderer());

// Book text is untrusted. Nothing it contains may make the renderer or a reader
// fetch an address other than an inline data: image.
describe("book HTML cannot reference remote or local resources", () => {
  it("drops remote images, iframes, stylesheets and SVG images", () => {
    const out = render(
      [
        '<img src="http://169.254.169.254/latest/meta-data/" alt="x"/>',
        '<iframe src="file:///etc/passwd"></iframe>',
        "<style>@import url(http://10.0.0.5/a.css);</style>",
        '<svg><image href="http://10.0.0.5/x.png"/></svg>',
        '<link rel="stylesheet" href="http://10.0.0.5/s.css"/>',
        '<div style="background:url(http://10.0.0.5/bg.png)">t</div>',
      ].join("\n\n"),
    );
    expect(out).not.toContain("169.254");
    expect(out).not.toContain("file:///");
    expect(out).not.toContain("10.0.0.5");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<iframe");
  });

  it("keeps inline data: images and plain http(s) links", () => {
    const out = render(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok"/>\n\n[site](https://example.com)',
    );
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out).toContain('href="https://example.com"');
  });

  it("removes javascript: links", () => {
    const out = render('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
  });

  it("sanitises SVG blocks the same way", () => {
    const out = render('```svg\n<svg xmlns="http://www.w3.org/2000/svg"><image href="http://10.0.0.5/x.png"/></svg>\n```');
    expect(out).not.toContain("10.0.0.5");
  });

  it("removes CSS url() that points anywhere except a local #fragment", () => {
    const out = render('<svg><rect fill="url(http://10.0.0.5/p.svg#a)" width="5" height="5"/></svg>');
    expect(out).not.toContain("10.0.0.5");
  });

  it("keeps a local #fragment url()", () => {
    const out = render('<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="5" height="5"/></svg>');
    expect(out).toContain('fill="url(#g)"');
  });

  it("does not let book text ask for a diagram by guessing the placeholder", () => {
    const out = render("Look: SBQTRUSTEDDIAGRAM0END and SBQ0D0END");
    expect(out).toContain("SBQTRUSTEDDIAGRAM0END");
  });

  it("removes CSS-escaped and comment-split url() forms", () => {
    const escaped = render('<svg><rect fill="u\\72l(http://10.0.0.5/p.svg#a)" width="5" height="5"/></svg>');
    const commented = render('<svg><rect fill="u/**/rl(http://10.0.0.5/q.svg#a)" width="5" height="5"/></svg>');
    expect(escaped).not.toContain("10.0.0.5");
    expect(commented).not.toContain("10.0.0.5");
  });

  it("does not throw on out-of-range CSS escapes and still removes a fetch behind one", () => {
    expect(() => render('<svg><rect fill="\\FFFFFF" width="5" height="5"/></svg>')).not.toThrow();
    expect(() => render('<svg><rect fill="\\D800" width="5" height="5"/></svg>')).not.toThrow();
    const out = render('<svg><rect fill="\\FFFFFFu\\72l(http://10.0.0.5/p.svg#a)" width="5" height="5"/></svg>');
    expect(out).not.toContain("10.0.0.5");
  });

  it("removes url() split by whitespace or escapes", () => {
    const spaced = render('<svg><rect fill="u r l(http://10.0.0.5/p.svg#a)" width="5" height="5"/></svg>');
    const escapedSpace = render('<svg><rect fill="u\\72 \\6c(http://10.0.0.5/p.svg#a)" width="5" height="5"/></svg>');
    expect(spaced).not.toContain("10.0.0.5");
    expect(escapedSpace).not.toContain("10.0.0.5");
  });
});
