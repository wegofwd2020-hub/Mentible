import { figureAltText, renderFiguresHtml } from "@/lib/figuresHtml";
import type { TopicImage } from "@/types/book";

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

  // The WebView-twin parity tests that lived here are GONE — and so is the twin.
  // #325 deleted the WebView's ~130-line duplicate renderer: markdown is now
  // rendered in RN by the one shared renderer and the finished HTML is shipped
  // into the document. There is no second implementation left to drift from, so
  // parity is structural rather than something tests must police. The reader's
  // own output is covered by __tests__/reader/offline-and-breakout.test.ts.
  //
  // This is the good outcome the #324 parity tests were pointing at: the fix for
  // "two implementations disagree" is one implementation.
});
