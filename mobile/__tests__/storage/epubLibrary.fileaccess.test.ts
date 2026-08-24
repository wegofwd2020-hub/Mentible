// Native file accessors for the streamed EPUB sync path (Inc 2.1 / Task 4):
// `getEpubFileUri` (native path lookup) and `saveEpubFileNative` (adopts an
// already-decrypted plaintext file by MOVING it into the library — no bytes
// cross the JS bridge). jest-expo defaults Platform.OS to "ios", so the
// native branch runs by default.
//
// The critical regression this guards (see syncEpubs.convergence.test.ts):
// the index entry must carry the CALLER'S `compiledAt`, never `now()` — a
// fresh timestamp here would make the puller look locally-newer than the
// server on the very next reconcile and re-push the whole EPUB right back.

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
    getInfoAsync: jest.fn((uri: string) =>
      Promise.resolve(
        uri in files ? { exists: true, size: files[uri].length } : { exists: false },
      ),
    ),
    makeDirectoryAsync: jest.fn((uri: string) => {
      files[uri] = "<dir>";
      return Promise.resolve();
    }),
    writeAsStringAsync: jest.fn((uri: string, contents: string) => {
      files[uri] = contents;
      return Promise.resolve();
    }),
    readAsStringAsync: jest.fn((uri: string) => Promise.resolve(files[uri] ?? "")),
    deleteAsync: jest.fn((uri: string) => {
      delete files[uri];
      return Promise.resolve();
    }),
    moveAsync: jest.fn(({ from, to }: { from: string; to: string }) => {
      if (!(from in files)) throw new Error(`moveAsync: source not found: ${from}`);
      files[to] = files[from];
      delete files[from];
      return Promise.resolve();
    }),
    __files: files,
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { getEpubFileUri, listEpubs, saveEpubFileNative } from "../../src/storage/epubLibrary";

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  const files = (FileSystem as unknown as { __files: Record<string, string> }).__files;
  for (const k of Object.keys(files)) delete files[k];
});

const PLAINTEXT_URI = "file:///docs/tmp/decrypted-b1.epub";
const PASSED_COMPILED_AT = "2026-01-01T00:00:00.000Z";

it("adopts a decrypted plaintext file and indexes it with the given compiledAt", async () => {
  const files = (FileSystem as unknown as { __files: Record<string, string> }).__files;
  // Seed a fake already-decrypted temp plaintext file (as the sync engine
  // would have produced via its own file-based decrypt).
  files[PLAINTEXT_URI] = "plaintext-epub-bytes";

  const meta = await saveEpubFileNative({
    bookId: "b1",
    title: "Physics",
    compiledAt: PASSED_COMPILED_AT,
    plaintextUri: PLAINTEXT_URI,
  });

  // The dest path is where getEpubFileUri says it should be.
  const destUri = getEpubFileUri("b1");
  expect(destUri).toBe("file:///docs/epubs/b1.epub");

  // The file was MOVED (no bytes through JS): source gone, dest holds the
  // original content, and no separate write call put bytes there.
  expect(files[PLAINTEXT_URI]).toBeUndefined();
  expect(files[destUri]).toBe("plaintext-epub-bytes");
  expect(FileSystem.moveAsync).toHaveBeenCalledWith({ from: PLAINTEXT_URI, to: destUri });

  // Returned meta + index entry reflect getInfoAsync's size and — critically
  // — the CALLER'S compiledAt, not a fresh now().
  expect(meta).toMatchObject({
    id: "b1",
    title: "Physics",
    sizeBytes: "plaintext-epub-bytes".length,
    compiledAt: PASSED_COMPILED_AT,
  });

  const list = await listEpubs();
  expect(list).toHaveLength(1);
  expect(list[0].compiledAt).toBe(PASSED_COMPILED_AT);
  expect(list[0].sizeBytes).toBe("plaintext-epub-bytes".length);
});

it("replaces an existing entry for the same id (delete-then-move, not append)", async () => {
  const files = (FileSystem as unknown as { __files: Record<string, string> }).__files;
  files["file:///docs/epubs/b1.epub"] = "stale-old-epub";
  files[PLAINTEXT_URI] = "fresh-epub-bytes";

  await saveEpubFileNative({
    bookId: "b1",
    title: "Physics v2",
    compiledAt: "2026-02-02T00:00:00.000Z",
    plaintextUri: PLAINTEXT_URI,
  });

  const list = await listEpubs();
  expect(list).toHaveLength(1);
  expect(list[0].title).toBe("Physics v2");
  expect(files["file:///docs/epubs/b1.epub"]).toBe("fresh-epub-bytes");
});

it("getEpubFileUri returns the on-disk path for a given id without touching the fs", () => {
  expect(getEpubFileUri("some-id")).toBe("file:///docs/epubs/some-id.epub");
});
