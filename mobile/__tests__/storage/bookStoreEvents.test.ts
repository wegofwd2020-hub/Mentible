import "fake-indexeddb/auto";

// Mock expo-file-system to isolate this test.
jest.mock("expo-file-system", () => ({
  documentDirectory: "file:///doc/",
  deleteAsync: jest.fn(async () => {}),
}));

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
import { subscribeBookStore, saveBook, deleteBook } from "@/storage/bookStore";
import type { Book } from "@/types/book";

function makeBook(id: string, title: string): Book {
  return {
    id,
    title,
    toc: { subjects: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  jest.clearAllMocks();
});

describe("subscribeBookStore", () => {
  it("notifies on save and delete, and unsubscribe stops it", async () => {
    let n = 0;
    const off = subscribeBookStore(() => {
      n++;
    });

    await saveBook(makeBook("b1", "T"));
    await deleteBook("b1");
    expect(n).toBe(2);

    off();
    await saveBook(makeBook("b2", "T"));
    expect(n).toBe(2);
  });
});
