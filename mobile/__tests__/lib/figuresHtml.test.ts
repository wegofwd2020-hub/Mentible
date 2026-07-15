import { renderFiguresHtml } from "@/lib/figuresHtml";
import type { TopicImage } from "@/types/book";

const img = (id: string, caption?: string): TopicImage => ({
  id, file: `media/b/${id}.png`, mime: "image/png", caption, addedAt: "x",
});

describe("renderFiguresHtml", () => {
  it("returns empty string when no images resolve", () => {
    expect(renderFiguresHtml([], new Map())).toBe("");
    expect(renderFiguresHtml([img("a")], new Map())).toBe(""); // no dataUrl → skipped
  });
  it("emits a figure per resolved image with escaped caption and data: src", () => {
    const urls = new Map([["a", "data:image/png;base64,AAAA"]]);
    const html = renderFiguresHtml([img("a", "A <b>cap</b>")], urls);
    expect(html).toContain('<section class="figures">');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("A &lt;b&gt;cap&lt;/b&gt;");
    expect(html).not.toContain("<b>cap</b>");
  });
});
