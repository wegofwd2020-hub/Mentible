// Exercises the native (expo-file-system) library path. jest-expo sets
// Platform.OS = "ios", so epubLibrary uses the file + index implementation.

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

jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  return {
    __esModule: true,
    documentDirectory: "file:///docs/",
    EncodingType: { Base64: "base64" },
    getInfoAsync: jest.fn((uri: string) => Promise.resolve({ exists: uri in files })),
    makeDirectoryAsync: jest.fn((uri: string) => {
      files[uri] = "<dir>";
      return Promise.resolve();
    }),
    writeAsStringAsync: jest.fn((uri: string, contents: string) => {
      files[uri] = contents;
      return Promise.resolve();
    }),
    deleteAsync: jest.fn((uri: string) => {
      delete files[uri];
      return Promise.resolve();
    }),
    __files: files,
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { deleteEpub, listEpubs, saveEpub } from "../../src/storage/epubLibrary";

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

function bytesOf(...nums: number[]): ArrayBuffer {
  return new Uint8Array(nums).buffer;
}

it("saves an EPUB to a file + index and lists it", async () => {
  const meta = await saveEpub({ bookId: "b1", title: "Physics", bytes: bytesOf(1, 2, 3, 4, 5) });
  expect(meta).toMatchObject({ id: "b1", title: "Physics", sizeBytes: 5 });

  const list = await listEpubs();
  expect(list).toHaveLength(1);
  expect(list[0].title).toBe("Physics");

  // The bytes were written base64-encoded and round-trip correctly.
  const files = (FileSystem as unknown as { __files: Record<string, string> }).__files;
  const written = files["file:///docs/epubs/b1.epub"];
  expect(Buffer.from(written, "base64")).toEqual(Buffer.from([1, 2, 3, 4, 5]));
});

it("stores a cover thumbnail and exposes it as coverUri", async () => {
  const meta = await saveEpub({
    bookId: "b1",
    title: "Physics",
    bytes: bytesOf(1, 2, 3),
    coverBytes: bytesOf(9, 8, 7),
  });
  expect(meta.coverUri).toBe("file:///docs/epubs/covers/b1.png");

  const files = (FileSystem as unknown as { __files: Record<string, string> }).__files;
  expect(Buffer.from(files["file:///docs/epubs/covers/b1.png"], "base64")).toEqual(
    Buffer.from([9, 8, 7]),
  );
  const list = await listEpubs();
  expect(list[0].coverUri).toBe("file:///docs/epubs/covers/b1.png");
});

it("omits coverUri when no cover bytes are provided", async () => {
  const meta = await saveEpub({ bookId: "b2", title: "No cover", bytes: bytesOf(1) });
  expect(meta.coverUri).toBeUndefined();
});

it("replaces the entry when the same book is saved again (one entry per book)", async () => {
  await saveEpub({ bookId: "b1", title: "Old", bytes: bytesOf(1) });
  await saveEpub({ bookId: "b1", title: "New", bytes: bytesOf(1, 2) });
  const list = await listEpubs();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: "b1", title: "New", sizeBytes: 2 });
});

it("lists newest first and deletes by id", async () => {
  await saveEpub({ bookId: "a", title: "A", bytes: bytesOf(1) });
  await new Promise((r) => setTimeout(r, 5));
  await saveEpub({ bookId: "b", title: "B", bytes: bytesOf(1) });

  let list = await listEpubs();
  expect(list.map((m) => m.id)).toEqual(["b", "a"]); // newest first

  await deleteEpub("b");
  list = await listEpubs();
  expect(list.map((m) => m.id)).toEqual(["a"]);
});
