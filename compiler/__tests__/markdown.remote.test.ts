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
});
