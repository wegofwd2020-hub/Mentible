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
import {
  deleteBook,
  ensureTopicIds,
  loadBook,
  loadBookIndex,
  saveBook,
  setTopicContent,
} from "../../src/storage/bookStore";
import type { Book, GeneratedTopic } from "../../src/types/book";

const LESSON = {
  topic: "x",
  level: "student",
  language: "en",
  synopsis: "s",
  learning_objectives: ["a"],
  sections: [{ heading: "h", body_markdown: "b" }],
  key_takeaways: ["k"],
  further_reading: [],
};

function gen(topicId: string): GeneratedTopic {
  return { topicId, title: "T", lesson: LESSON, generatedAt: "2026-05-26T12:00:00.000Z" };
}

function makeBook(id: string, title: string): Book {
  return {
    id,
    title,
    toc: {
      subjects: [
        {
          subject_label: "Physics",
          units: [
            { title: "Kinematics", subtopics: ["Speed", "Velocity"], prerequisites: [] },
            { title: "Dynamics", subtopics: [], prerequisites: [] },
          ],
        },
      ],
    },
    createdAt: "2026-05-26T10:00:00.000Z",
    updatedAt: "2026-05-26T10:00:00.000Z",
  };
}

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  jest.clearAllMocks();
});

describe("bookStore", () => {
  it("saves a book and indexes it with derived counts", async () => {
    await saveBook(makeBook("b1", "Physics Primer"));

    const index = await loadBookIndex();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      id: "b1",
      title: "Physics Primer",
      subjectCount: 1,
      unitCount: 2,
    });
  });

  it("round-trips the full book by id", async () => {
    await saveBook(makeBook("b1", "Physics Primer"));
    const loaded = await loadBook("b1");
    expect(loaded?.toc.subjects[0].units[0].title).toBe("Kinematics");
  });

  it("returns null for a missing book", async () => {
    expect(await loadBook("nope")).toBeNull();
  });

  it("puts the most recently saved book first and dedups by id", async () => {
    await saveBook(makeBook("b1", "First"));
    await saveBook(makeBook("b2", "Second"));
    await saveBook(makeBook("b1", "First (edited)"));

    const index = await loadBookIndex();
    expect(index.map((m) => m.id)).toEqual(["b1", "b2"]);
    expect(index[0].title).toBe("First (edited)");
  });

  it("deletes a book from both the entry and the index", async () => {
    await saveBook(makeBook("b1", "First"));
    await saveBook(makeBook("b2", "Second"));

    await deleteBook("b1");

    expect(await loadBook("b1")).toBeNull();
    expect((await loadBookIndex()).map((m) => m.id)).toEqual(["b2"]);
  });
});

describe("ensureTopicIds", () => {
  it("assigns ids only to topics missing them, preserving existing ones", () => {
    const out = ensureTopicIds({
      subjects: [
        {
          subject_label: "Physics",
          units: [
            { id: "keep", title: "Kinematics", subtopics: [], prerequisites: [] },
            { title: "Dynamics", subtopics: [], prerequisites: [] },
          ],
        },
      ],
    });
    expect(out.subjects[0].units[0].id).toBe("keep");
    expect(out.subjects[0].units[1].id).toBeTruthy();
  });
});

describe("setTopicContent", () => {
  it("attaches content keyed by topic id and bumps updatedAt", () => {
    const book = makeBook("b1", "First");
    book.toc.subjects[0].units[0].id = "t1";
    const next = setTopicContent(book, gen("t1"));
    expect(next.content?.["t1"]?.lesson).toBe(LESSON);
    expect(next.updatedAt).not.toBe(book.updatedAt);
  });
});

describe("content persistence + pruning", () => {
  it("backfills topic ids on load for older books", async () => {
    await saveBook(makeBook("b1", "First")); // makeBook units have no ids
    const loaded = await loadBook("b1");
    expect(loaded?.toc.subjects[0].units.every((u) => !!u.id)).toBe(true);
  });

  it("prunes generated content for topics no longer in the tree", async () => {
    const book = makeBook("b1", "First");
    book.toc.subjects[0].units[0].id = "t1";
    book.toc.subjects[0].units[1].id = "t2";
    book.content = { t1: gen("t1"), t2: gen("t2"), ghost: gen("ghost") };

    await saveBook(book);
    const loaded = await loadBook("b1");

    expect(Object.keys(loaded?.content ?? {}).sort()).toEqual(["t1", "t2"]);
  });
});
