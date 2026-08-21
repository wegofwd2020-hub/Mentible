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
import { deleteEpub, listEpubs, saveEpub, subscribeEpubLibrary } from "../../src/storage/epubLibrary";

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

describe("compiledAt (ADR-014 increment 2 — preserved on a synced pull)", () => {
  it("a locally-authored save (no compiledAt passed) still defaults to now()", async () => {
    const before = Date.now();
    const meta = await saveEpub({ bookId: "b1", title: "Physics", bytes: bytesOf(1) });
    const after = Date.now();

    expect(Date.parse(meta.compiledAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(meta.compiledAt)).toBeLessThanOrEqual(after);
  });

  it("a synced pull's ORIGINAL compiledAt is preserved verbatim, not overwritten with now()", async () => {
    // The regression this guards against: syncEngine's syncEpubs pull path
    // once called saveEpub without `compiledAt`, which meant every pulled
    // epub silently got a fresh now() here instead of the original compile
    // time — making it look locally-newer than the server on the very next
    // reconcile and forcing a re-push of the whole (potentially tens-of-MB)
    // file right back. `compiledAt` passed through here must win over
    // whatever now() would have been.
    const originalCompiledAt = "2020-01-01T00:00:00.000Z"; // deliberately far in the past
    const meta = await saveEpub({
      bookId: "b2",
      title: "Pulled Book",
      bytes: bytesOf(1),
      compiledAt: originalCompiledAt,
    });

    expect(meta.compiledAt).toBe(originalCompiledAt);
    expect((await listEpubs())[0].compiledAt).toBe(originalCompiledAt);
  });
});

describe("subscribeEpubLibrary", () => {
  it("fires the listener on saveEpub and deleteEpub, and not after unsubscribe", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeEpubLibrary(listener);

    await saveEpub({ bookId: "b1", title: "Physics", bytes: bytesOf(1) });
    expect(listener).toHaveBeenCalledTimes(1);

    await deleteEpub("b1");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await saveEpub({ bookId: "b2", title: "Chemistry", bytes: bytesOf(1) });
    expect(listener).toHaveBeenCalledTimes(2); // no further calls once unsubscribed
  });

  it("a throwing listener does not break saveEpub", async () => {
    const throwing = jest.fn(() => {
      throw new Error("listener boom");
    });
    subscribeEpubLibrary(throwing);

    const meta = await saveEpub({ bookId: "b3", title: "Biology", bytes: bytesOf(1) });
    expect(meta).toMatchObject({ id: "b3", title: "Biology" });
    expect(throwing).toHaveBeenCalled();
  });
});
