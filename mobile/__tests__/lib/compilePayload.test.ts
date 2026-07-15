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
    expect(secs.at(-1)!.body_markdown).toContain("![Fig 1. Cap](data:image/jpeg;base64,ZZ)");
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
    expect(md).toContain("Fig 1. Cap");
    expect(md).not.toContain("Fig 2.");
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
