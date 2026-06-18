import { hasRenderableLesson, generatedTopicIds } from "@/storage/bookStore";
import type { Book, GeneratedTopic } from "@/types/book";

function gen(over: Partial<GeneratedTopic["lesson"]> | null): GeneratedTopic {
  return {
    topicId: "t",
    title: "T",
    lesson: over === null ? (undefined as never) : ({ topic: "T", synopsis: "", sections: [], ...over } as never),
    generatedAt: "2026-01-01T00:00:00Z",
  } as GeneratedTopic;
}

describe("hasRenderableLesson", () => {
  it("is false for missing / empty entries", () => {
    expect(hasRenderableLesson(undefined)).toBe(false);
    expect(hasRenderableLesson(null)).toBe(false);
    expect(hasRenderableLesson(gen(null))).toBe(false); // no lesson
    expect(hasRenderableLesson(gen({ synopsis: "", sections: [] }))).toBe(false); // empty body
    expect(hasRenderableLesson(gen({ synopsis: "   ", sections: [] }))).toBe(false); // whitespace
  });

  it("is true when there is a real body", () => {
    expect(
      hasRenderableLesson(gen({ sections: [{ heading: "H", body_markdown: "b" }] as never })),
    ).toBe(true);
    expect(hasRenderableLesson(gen({ synopsis: "A real synopsis." }))).toBe(true);
  });
});

describe("generatedTopicIds", () => {
  it("only counts topics whose lesson is renderable", () => {
    const book = {
      content: {
        good: gen({ sections: [{ heading: "H", body_markdown: "b" }] as never }),
        empty: gen({ synopsis: "", sections: [] }),
      },
    } as unknown as Book;
    expect(generatedTopicIds(book)).toEqual(["good"]);
  });

  it("is empty when there's no content", () => {
    expect(generatedTopicIds({} as Book)).toEqual([]);
  });
});
