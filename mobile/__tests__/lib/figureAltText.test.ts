import { figureAltText, renderFiguresHtml } from "@/lib/figuresHtml";
import { RENDER_HELPERS_JS } from "@/components/contentHtml";
import type { TopicImage } from "@/types/book";

// NOTE on `new Function(RENDER_HELPERS_JS)` below: the operand is a first-party
// compile-time constant from our own source — never user input, never
// interpolated with untrusted data. Executing it here is exactly what the
// WebView does in production, which is the whole point: it is the only way to
// test the hand-duplicated twin's BEHAVIOUR rather than its source text.

const img = (over: Partial<TopicImage> = {}): TopicImage => ({
  id: "a", file: "media/b/a.png", mime: "image/png", addedAt: "x", ...over,
});

// An attached figure is meaningful by definition — an author does not attach
// decoration to a lesson topic. So `alt` must NEVER be "", which is HTML for
// "decorative, skip me". Before this, both readers emitted alt="" for an
// uncaptioned figure and a screen reader announced nothing at all.
describe("figureAltText", () => {
  it("prefers explicit alt over caption", () => {
    expect(figureAltText(img({ alt: "A circular diagram of eight steps", caption: "Fig 1" }), 0))
      .toBe("A circular diagram of eight steps");
  });

  it("falls back to the caption when there is no alt", () => {
    expect(figureAltText(img({ caption: "The Krebs cycle" }), 0)).toBe("The Krebs cycle");
  });

  it("falls back to a positional label when there is neither — never empty", () => {
    expect(figureAltText(img(), 0)).toBe("Figure 1");
    expect(figureAltText(img(), 4)).toBe("Figure 5");
  });

  it("treats blank/whitespace-only values as absent (never emits a blank alt)", () => {
    expect(figureAltText(img({ alt: "   ", caption: "" }), 0)).toBe("Figure 1");
    expect(figureAltText(img({ alt: "", caption: "  Real caption  " }), 0)).toBe("Real caption");
  });

  it("is never the empty string for any input — the invariant that matters", () => {
    const cases: TopicImage[] = [
      img(), img({ alt: "" }), img({ caption: "" }), img({ alt: "  ", caption: "  " }),
      img({ alt: undefined, caption: undefined }),
    ];
    for (const c of cases) expect(figureAltText(c, 0)).not.toBe("");
  });
});

// The three surfaces that render a figure previously inlined THREE different alt
// expressions and already disagreed: the readers emitted "" while the compile
// payload emitted "Fig 1. ". They must now agree, via the one resolver.
describe("every surface uses the resolver (no alt drift)", () => {
  const urls = new Map([["a", "data:image/png;base64,AAAA"]]);

  it("web reader: uncaptioned figure gets a real alt, never alt=''", () => {
    const html = renderFiguresHtml([img()], urls);
    expect(html).toContain('alt="Figure 1"');
    expect(html).not.toContain('alt=""');
  });

  it("web reader: explicit alt wins and is escaped", () => {
    const html = renderFiguresHtml([img({ alt: 'A <b>diagram</b>', caption: "Cap" })], urls);
    expect(html).toContain('alt="A &lt;b&gt;diagram&lt;/b&gt;"');
  });

  // The WebView twin is hand-duplicated JS that jest historically "couldn't
  // execute", so it was only ever asserted as source TEXT. That is vacuous: the
  // string 'Figure ' appears in the function definition whether or not the call
  // site uses it, so reverting the call site kept such a test green. Execute the
  // real thing instead.
  // The twin's JS builds a `new marked.Renderer()` at load time (the WebView
  // loads marked from a CDN-free bundle). renderFigures itself needs neither
  // marked nor mermaid, so stub just enough for the module body to evaluate.
  const markedStub = { Renderer: function () { /* fields assigned by the twin */ } };
  const twin = new Function(
    "marked",
    "mermaid",
    `${RENDER_HELPERS_JS}\nreturn { renderFigures: renderFigures };`,
  )(markedStub, {}) as {
    renderFigures: (images: TopicImage[], urls: Record<string, string>) => string;
  };
  const twinUrls = { a: "data:image/png;base64,AAAA" };

  it("WebView twin: uncaptioned figure gets a real alt, never alt=''", () => {
    const html = twin.renderFigures([img()], twinUrls);
    expect(html).toContain('alt="Figure 1"');
    expect(html).not.toContain('alt=""');
  });

  it("WebView twin agrees with figuresHtml for every precedence case (no drift)", () => {
    const cases: TopicImage[] = [
      img({ alt: "Explicit alt", caption: "Cap" }),
      img({ caption: "Only a caption" }),
      img(),
      img({ alt: "   ", caption: "  Trimmed  " }),
      img({ alt: 'Quote "x" & <tag>' }),
    ];
    for (const c of cases) {
      const web = renderFiguresHtml([c], urls);
      const wv = twin.renderFigures([c], twinUrls);
      const altOf = (h: string) => h.match(/alt="([^"]*)"/)?.[1];
      expect(altOf(wv)).toBe(altOf(web)); // the two readers must stay in step
      expect(altOf(wv)).not.toBe("");
    }
  });
});
