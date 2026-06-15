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
import { seedDefaultLibrary } from "@/storage/seedLibrary";
import type { BundledBook } from "@/storage/bundledLibrary";
import { deleteBook, loadBook, loadBookIndex, saveBook } from "@/storage/bookStore";
import type { Book } from "@/types/book";

const reset = () => (AsyncStorage as unknown as { __reset: () => void }).__reset();

function bookJson(id: string, title: string): string {
  return JSON.stringify({
    id,
    title,
    toc: {
      subjects: [
        {
          subject_label: "S",
          units: [{ id: `${id}-u1`, title: "U", subtopics: [], prerequisites: [] }],
        },
      ],
    },
  });
}

function bundled(over: Partial<BundledBook> & Pick<BundledBook, "id">): BundledBook {
  return {
    version: "1",
    status: "published",
    raw: bookJson(over.id, "Bundled Title"),
    ...over,
  };
}

beforeEach(reset);

describe("seedDefaultLibrary", () => {
  it("imports a published book and tags it source:bundled", async () => {
    const res = await seedDefaultLibrary([bundled({ id: "b1" })]);

    expect(res.seeded).toEqual(["b1"]);
    const index = await loadBookIndex();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ id: "b1", source: "bundled" });
    const stored = await loadBook("b1");
    expect(stored?.source).toBe("bundled");
  });

  it("skips draft books", async () => {
    const res = await seedDefaultLibrary([bundled({ id: "d1", status: "draft" })]);

    expect(res.seeded).toEqual([]);
    expect(res.skipped).toEqual(["d1"]);
    expect(await loadBookIndex()).toHaveLength(0);
  });

  it("is idempotent — a second run imports nothing", async () => {
    await seedDefaultLibrary([bundled({ id: "b1" })]);
    const res = await seedDefaultLibrary([bundled({ id: "b1" })]);

    expect(res.seeded).toEqual([]);
    expect(res.skipped).toEqual(["b1"]);
    expect(await loadBookIndex()).toHaveLength(1);
  });

  it("does not resurrect a seeded book the user deleted", async () => {
    await seedDefaultLibrary([bundled({ id: "b1" })]);
    await deleteBook("b1");

    const res = await seedDefaultLibrary([bundled({ id: "b1" })]);

    expect(res.seeded).toEqual([]);
    expect(await loadBook("b1")).toBeNull();
  });

  it("re-seeds when the manifest version bumps", async () => {
    await seedDefaultLibrary([bundled({ id: "b1", version: "1" })]);

    const res = await seedDefaultLibrary([
      { id: "b1", version: "2", status: "published", raw: bookJson("b1", "Second Edition") },
    ]);

    expect(res.seeded).toEqual(["b1"]);
    expect((await loadBook("b1"))?.title).toBe("Second Edition");
  });

  it("never overwrites a user-owned book with the same id", async () => {
    const userBook: Book = {
      id: "b1",
      title: "My Own Book",
      source: "user",
      toc: { subjects: [{ subject_label: "S", units: [] }] },
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    await saveBook(userBook);

    const res = await seedDefaultLibrary([bundled({ id: "b1" })]);

    expect(res.skipped).toEqual(["b1"]);
    expect((await loadBook("b1"))?.title).toBe("My Own Book");
  });

  it("records a malformed bundled book as failed without throwing", async () => {
    const res = await seedDefaultLibrary([
      { id: "bad", version: "1", status: "published", raw: "{ not json" },
    ]);

    expect(res.failed).toEqual(["bad"]);
    expect(await loadBookIndex()).toHaveLength(0);
  });
});
