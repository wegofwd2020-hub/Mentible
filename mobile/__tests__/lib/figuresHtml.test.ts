import { countBookFigures, renderFiguresHtml } from "@/lib/figuresHtml";
import type { Book, TopicImage } from "@/types/book";

const img = (id: string, caption?: string): TopicImage => ({
  id, file: `media/b/${id}.png`, mime: "image/png", caption, addedAt: "x",
});

function bookWith(images: Record<string, TopicImage[]>): Book {
  const content = Object.fromEntries(
    Object.entries(images).map(([topicId, imgs]) => [
      topicId,
      { topicId, title: "U", lesson: {} as never, generatedAt: "x", images: imgs },
    ]),
  );
  return { id: "b", title: "T", toc: { subjects: [] }, createdAt: "x", updatedAt: "x", content } as unknown as Book;
}

describe("countBookFigures", () => {
  it("counts every topic's figures across the book", () => {
    expect(countBookFigures(bookWith({ t1: [img("a"), img("b")], t2: [img("c")] }))).toBe(3);
  });
  it("is 0 for a book with no figures, no content, or topics without an images key", () => {
    expect(countBookFigures(bookWith({ t1: [] }))).toBe(0);
    expect(countBookFigures({ id: "b", title: "T" } as unknown as Book)).toBe(0);
    // A topic generated before media slice 1 has no `images` key at all — the
    // shape every pre-#318 book on disk still has.
    const legacy = {
      id: "b", title: "T",
      content: { t1: { topicId: "t1", title: "U", lesson: {}, generatedAt: "x" } },
    } as unknown as Book;
    expect(countBookFigures(legacy)).toBe(0);
  });
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
