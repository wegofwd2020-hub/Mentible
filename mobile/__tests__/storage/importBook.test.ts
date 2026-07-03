// In-memory AsyncStorage mock — declared before importing the store.
jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      setItem: jest.fn((k: string, v: string) => {
        store[k] = v;
        return Promise.resolve();
      }),
      getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
      removeItem: jest.fn((k: string) => {
        delete store[k];
        return Promise.resolve();
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ImportError, importBook, parseBook } from "@/storage/importBook";
import { loadBook, loadBookIndex } from "@/storage/bookStore";

const reset = () => (AsyncStorage as unknown as { __reset: () => void }).__reset();

function validBookJson(overrides: Record<string, unknown> = {}): string {
  const tid = "abc-topic-1";
  return JSON.stringify({
    id: "authored-proj-1",
    title: "Context Engineering in the Enterprise",
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    toc: {
      subjects: [
        {
          subject_label: "Context Engineering",
          units: [{ id: tid, title: "Why CE Emerged", subtopics: [], prerequisites: [] }],
        },
      ],
    },
    content: {
      [tid]: {
        topicId: tid,
        title: "Why CE Emerged",
        generatedAt: "2026-05-26T00:00:00Z",
        lesson: {
          topic: "Why CE Emerged",
          level: "Grade 11",
          language: "en",
          synopsis: "…",
          learning_objectives: ["Explain"],
          sections: [{ heading: "Intro", body_markdown: "body" }],
          key_takeaways: ["t1"],
          further_reading: [],
        },
      },
    },
    ...overrides,
  });
}

describe("parseBook", () => {
  it("parses a valid book and keeps id/title/toc/content", () => {
    const book = parseBook(validBookJson());
    expect(book.id).toBe("authored-proj-1");
    expect(book.title).toBe("Context Engineering in the Enterprise");
    expect(book.toc.subjects[0].units[0].id).toBe("abc-topic-1");
    expect(book.content?.["abc-topic-1"].lesson.topic).toBe("Why CE Emerged");
  });

  it("refreshes updatedAt but preserves createdAt", () => {
    const book = parseBook(validBookJson());
    expect(book.createdAt).toBe("2026-05-26T00:00:00Z");
    expect(book.updatedAt).not.toBe("2026-05-26T00:00:00Z");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseBook("{not json")).toThrow(ImportError);
  });

  it("throws when title is missing", () => {
    expect(() => parseBook(validBookJson({ title: "" }))).toThrow(/title/i);
  });

  it("throws when toc.subjects is missing", () => {
    expect(() => parseBook(validBookJson({ toc: {} }))).toThrow(/table of contents/i);
  });

  it("throws when the top level is not an object", () => {
    expect(() => parseBook("[]")).toThrow(ImportError);
  });

  it("assigns an id when none is provided", () => {
    const book = parseBook(validBookJson({ id: undefined }));
    expect(typeof book.id).toBe("string");
    expect(book.id.length).toBeGreaterThan(0);
  });

  it("preserves metadata (author + edition drive the cover) and generationParams", () => {
    const book = parseBook(
      validBookJson({
        metadata: {
          author: "Sridhar Parthasarathy",
          publisher: "Mentible",
          version: "2.0",
          edition: "Second Edition",
          status: "release",
          glossary: [{ term: "AI", definition: "…" }],
        },
        generationParams: { level: "Grade 11", language: "en" },
      }),
    );
    expect(book.metadata?.author).toBe("Sridhar Parthasarathy");
    expect(book.metadata?.version).toBe("2.0");
    expect(book.metadata?.edition).toBe("Second Edition");
    // Unmodelled-but-valid fields (e.g. glossary) survive the passthrough.
    expect((book.metadata as Record<string, unknown>).glossary).toBeDefined();
    expect(book.generationParams?.language).toBe("en");
  });

  it("omits metadata/generationParams when absent (no empty shells)", () => {
    const book = parseBook(validBookJson());
    expect("metadata" in book).toBe(false);
    expect("generationParams" in book).toBe(false);
  });
});

describe("parseBook — tags coercion (ADR-027 D7)", () => {
  const withMetadata = (metadata: unknown): string => {
    const obj = JSON.parse(validBookJson());
    obj.metadata = metadata;
    return JSON.stringify(obj);
  };

  it("keeps a valid string[] tags array", () => {
    const b = parseBook(withMetadata({ tags: ["ai", "product"] }));
    expect(b.metadata?.tags).toEqual(["ai", "product"]);
  });
  it("filters non-string tag entries", () => {
    const b = parseBook(withMetadata({ tags: ["ai", 2, null, "x"] }));
    expect(b.metadata?.tags).toEqual(["ai", "x"]);
  });
  it("drops a non-array tags value", () => {
    const b = parseBook(withMetadata({ tags: "not-an-array" }));
    expect(b.metadata?.tags).toBeUndefined();
  });
  it("preserves other metadata fields untouched", () => {
    const b = parseBook(withMetadata({ description: "d", status: "release", tags: ["t"] }));
    expect(b.metadata?.description).toBe("d");
    expect(b.metadata?.status).toBe("release");
  });
});

describe("importBook", () => {
  beforeEach(reset);

  it("persists the book so it round-trips via the store", async () => {
    const imported = await importBook(validBookJson());
    const loaded = await loadBook(imported.id);
    expect(loaded?.title).toBe("Context Engineering in the Enterprise");
    expect(loaded?.content?.["abc-topic-1"].lesson.sections[0].heading).toBe("Intro");

    const index = await loadBookIndex();
    expect(index.find((m) => m.id === imported.id)?.unitCount).toBe(1);
  });

  it("rejects an invalid book without writing it", async () => {
    await expect(importBook("nope")).rejects.toThrow(ImportError);
    expect(await loadBookIndex()).toEqual([]);
  });
});
