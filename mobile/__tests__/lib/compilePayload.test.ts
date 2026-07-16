jest.mock("@/storage/mediaStore", () => ({
  resolveFigureDataUrls: jest.fn(async (t: any) =>
    new Map((t.images ?? []).map((i: any) => [i.id, `data:${i.mime};base64,ZZ`])),
  ),
}));

import { buildCompilePayload } from "@/lib/compilePayload";
import type { Book } from "@/types/book";

function bookWithTopic(overrides: Partial<Book> = {}): Book {
  return {
    id: "b",
    title: "T",
    toc: { subjects: [] } as any,
    createdAt: "x",
    updatedAt: "x",
    content: {
      t1: {
        topicId: "t1",
        title: "U",
        generatedAt: "x",
        lesson: {
          topic: "U",
          synopsis: "s",
          learning_objectives: [],
          sections: [{ heading: "H", body_markdown: "b" }],
          key_takeaways: [],
        } as any,
        images: [{ id: "a", file: "media/b/a.jpg", mime: "image/jpeg", caption: "Cap", addedAt: "x" }],
      },
    },
    ...overrides,
  };
}

describe("buildCompilePayload", () => {
  it("appends a Figures section with a data: image; stored book untouched", async () => {
    const book = bookWithTopic();
    const payload = await buildCompilePayload(book);
    const secs = payload.content!.t1.lesson.sections;
    expect(secs.at(-1)!.heading).toBe("Figures");
    // Alt now comes from figureAltText (alt -> caption -> "Figure N"); this
    // figure has only a caption, so the caption is its alt.
    expect(secs.at(-1)!.body_markdown).toContain("![Cap](data:image/jpeg;base64,ZZ)");
    // input not mutated:
    expect(book.content!.t1.lesson.sections).toHaveLength(1);
    expect(JSON.stringify(book)).not.toContain("data:");
  });

  it("skips an image with no resolved dataUrl", async () => {
    const book = bookWithTopic({
      content: {
        t1: {
          topicId: "t1",
          title: "U",
          generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          images: [
            { id: "a", file: "media/b/a.jpg", mime: "image/jpeg", caption: "Cap", addedAt: "x" },
            { id: "missing", file: "media/b/missing.jpg", mime: "image/jpeg", addedAt: "x" },
          ],
        },
      },
    });
    // Override the mock for this test: "missing" resolves to nothing.
    const { resolveFigureDataUrls } = jest.requireMock("@/storage/mediaStore");
    (resolveFigureDataUrls as jest.Mock).mockImplementationOnce(async () =>
      new Map([["a", "data:image/jpeg;base64,ZZ"]]),
    );
    const payload = await buildCompilePayload(book);
    const md = payload.content!.t1.lesson.sections.at(-1)!.body_markdown;
    expect(md).toContain("![Cap](data:image/jpeg;base64,ZZ)");
    // The unresolved image carries no caption, so were it NOT skipped it would
    // render as `![Figure 2](…)` — this negative assertion still bites. (The
    // old `not.toContain("Fig 2.")` would now pass vacuously: nothing emits
    // "Fig N." any more.)
    expect(md).not.toContain("Figure 2");
    expect(md.split("![").length - 1).toBe(1); // exactly one image survived
  });

  it("markdown-escapes special characters in the caption", async () => {
    const book = bookWithTopic({
      content: {
        t1: {
          topicId: "t1",
          title: "U",
          generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          images: [{ id: "a", file: "media/b/a.jpg", mime: "image/jpeg", caption: "A [B] (C)", addedAt: "x" }],
        },
      },
    });
    const payload = await buildCompilePayload(book);
    const md = payload.content!.t1.lesson.sections.at(-1)!.body_markdown;
    expect(md).toContain("A \\[B\\] \\(C\\)");
  });

  it("leaves a topic with no images untouched", async () => {
    const book: Book = {
      id: "b", title: "T", toc: { subjects: [] } as any, createdAt: "x", updatedAt: "x",
      content: {
        t2: {
          topicId: "t2", title: "V", generatedAt: "x",
          lesson: {
            topic: "V", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
        },
      },
    };
    const payload = await buildCompilePayload(book);
    expect(payload.content!.t2.lesson.sections).toHaveLength(1);
    expect(payload.content!.t2.lesson.sections).not.toBe(book.content!.t2.lesson.sections);
  });
});

// The compiled EPUB/PDF is the third surface that renders a figure, and it
// disagreed with the two readers: `![Fig 1. ${cap}](src)` gave an uncaptioned
// figure alt="Fig 1. " — not empty (so not "decorative"), but meaningless to a
// screen reader. The readers meanwhile emitted alt="". Both are now the shared
// resolver's output. The visible <figcaption> is unchanged.
describe("compile payload alt text (#alt-text)", () => {
  it("uses the figure's alt text as the markdown image alt", async () => {
    const book = bookWithTopic();
    (book.content!.t1 as any).images = [
      { id: "i1", file: "media/b/i1.png", mime: "image/png", alt: "A circular diagram", caption: "Krebs", addedAt: "x" },
    ];
    const out = await buildCompilePayload(book);
    const md = out.content!.t1.lesson.sections!.at(-1)!.body_markdown;
    expect(md).toContain("![A circular diagram](data:image/png;base64,ZZ)");
  });

  it("an uncaptioned, alt-less figure gets a positional label, not a bare 'Fig N.'", async () => {
    const book = bookWithTopic();
    (book.content!.t1 as any).images = [
      { id: "i1", file: "media/b/i1.png", mime: "image/png", addedAt: "x" },
    ];
    const out = await buildCompilePayload(book);
    const md = out.content!.t1.lesson.sections!.at(-1)!.body_markdown;
    expect(md).toContain("![Figure 1](");
    expect(md).not.toContain("![Fig 1. ]("); // the old meaningless alt
  });

  it("never emits an empty markdown alt", async () => {
    const book = bookWithTopic();
    (book.content!.t1 as any).images = [
      { id: "i1", file: "media/b/i1.png", mime: "image/png", alt: "   ", caption: "", addedAt: "x" },
    ];
    const out = await buildCompilePayload(book);
    const md = out.content!.t1.lesson.sections!.at(-1)!.body_markdown;
    expect(md).not.toContain("![](");
  });
});
