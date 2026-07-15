import type { Book, TopicImage } from "@/types/book";

// Reuses the expo-file-system + expo-image-manipulator mock shape from
// mediaStore.test.ts, extended with writeAsStringAsync (bundle import writes a
// scratch file before re-stripping EXIF via the manipulator).
jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {}; // uri -> base64 contents
  const defaultGetInfoAsync = async (p: string) => ({ exists: p in files, size: 1234, uri: p });
  return {
    documentDirectory: "file:///doc/",
    cacheDirectory: "file:///cache/",
    getInfoAsync: jest.fn(defaultGetInfoAsync),
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      files[to] = files[from] ?? "COPIED";
    }),
    deleteAsync: jest.fn(async (p: string) => {
      delete files[p];
    }),
    writeAsStringAsync: jest.fn(async (p: string, contents: string) => {
      files[p] = contents;
    }),
    readAsStringAsync: jest.fn(async (p: string) => files[p] ?? "QUJD"),
    readDirectoryAsync: jest.fn(async () => Object.keys(files).map((f) => f.split("/").pop()!)),
    __files: files,
    __defaultGetInfoAsync: defaultGetInfoAsync,
    EncodingType: { Base64: "base64", UTF8: "utf8" },
  };
});
jest.mock("expo-image-manipulator", () => ({
  // Real expo-image-manipulator writes a new file with (re-encoded) content
  // derived from the source uri. This mock must propagate the SOURCE FILE'S
  // BYTES to the "stripped" uri — not just fabricate a placeholder — otherwise
  // the round-trip test below can't tell real bytes from the mock's own
  // "COPIED" fallback (see the expo-file-system copyAsync mock above).
  manipulateAsync: jest.fn(async (uri: string) => {
    const strippedUri = `${uri}.stripped`;
    const fs = require("expo-file-system");
    fs.__files[strippedUri] = fs.__files[uri];
    return { uri: strippedUri, width: 10, height: 8 };
  }),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

import * as FileSystem from "expo-file-system";
import { unzipSync, strFromU8 } from "fflate";
import { exportBookBundle, parseBookBundle } from "@/storage/bookBundle";

function bookWithImage(): Book {
  const image: TopicImage = {
    id: "img1",
    file: "media/bk1/img1.png",
    mime: "image/png",
    addedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    id: "bk1",
    title: "T",
    toc: { subjects: [{ title: "S", units: [{ id: "t1", title: "U" }] }] } as any,
    createdAt: "x",
    updatedAt: "x",
    content: {
      t1: {
        topicId: "t1",
        title: "U",
        lesson: { topic: "U", synopsis: "s", sections: [] } as any,
        generatedAt: "x",
        images: [image],
      },
    },
  };
}

afterEach(() => {
  (FileSystem.getInfoAsync as jest.Mock).mockImplementation((FileSystem as any).__defaultGetInfoAsync);
  for (const k of Object.keys((FileSystem as any).__files)) delete (FileSystem as any).__files[k];
  jest.clearAllMocks();
});

describe("bookBundle", () => {
  it("round-trips a book + media through a zip bundle", async () => {
    const book = bookWithImage();
    (FileSystem as any).__files["file:///doc/media/bk1/img1.png"] = "aW1hZ2UtYnl0ZXM="; // "image-bytes"
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => ({
      exists: p in (FileSystem as any).__files,
      size: 1234,
      uri: p,
    }));

    const zip = await exportBookBundle(book);
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toContain("book.json");
    expect(Object.keys(entries).some((k) => k.startsWith("media/"))).toBe(true);

    const bookJson = JSON.parse(strFromU8(entries["book.json"]));
    expect(bookJson.content.t1.images[0].file).toBe("media/img1.png");

    const back = await parseBookBundle(zip);
    expect(back.id).not.toBe(book.id); // fresh id on import
    expect(back.content!.t1.images![0].file).toMatch(new RegExp(`^media/${back.id}/`));

    // The ORIGINAL bytes actually landed at the new path (through the
    // EXIF-strip pipeline) — not just some placeholder value. Compare against
    // the exact base64 seeded above, not merely "is defined".
    const writtenPath = `file:///doc/${back.content!.t1.images![0].file}`;
    expect((FileSystem as any).__files[writtenPath]).toBe("aW1hZ2UtYnl0ZXM=");
  });

  it("keeps a book with no images out of the media/ folder (book.json only content)", async () => {
    const book: Book = {
      id: "bk2",
      title: "No images",
      toc: { subjects: [{ title: "S", units: [{ id: "t1", title: "U" }] }] } as any,
      createdAt: "x",
      updatedAt: "x",
      content: {
        t1: { topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x" },
      },
    };
    const zip = await exportBookBundle(book);
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toEqual(["book.json"]);
  });

  it("drops a ref whose media file is missing from the bundle instead of leaving a dangling ref", async () => {
    const book = bookWithImage();
    (FileSystem as any).__files["file:///doc/media/bk1/img1.png"] = "aW1hZ2UtYnl0ZXM=";
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => ({
      exists: p in (FileSystem as any).__files,
      size: 1234,
      uri: p,
    }));
    const zip = await exportBookBundle(book);
    const entries = unzipSync(zip);

    // Simulate a corrupted/truncated bundle missing its media entry: re-zip
    // with only book.json, exercising the real unzip path.
    const { zipSync } = jest.requireActual("fflate");
    const zipMissingMedia = zipSync({ "book.json": entries["book.json"] });
    const back = await parseBookBundle(zipMissingMedia);
    expect(back.content!.t1.images ?? []).toHaveLength(0);
  });

  it("drops an image with a missing/non-string file ref without aborting the import, keeping a valid sibling", async () => {
    const book = bookWithImage();
    const { zipSync, strToU8 } = jest.requireActual("fflate");
    const validImage = book.content!.t1.images![0]; // file: "media/bk1/img1.png"
    const malformedImage = { id: "img-bad", mime: "image/png" }; // no `file` at all
    const bundle = zipSync({
      "book.json": strToU8(
        JSON.stringify({
          ...book,
          content: {
            t1: { ...book.content!.t1, images: [validImage, malformedImage] },
          },
        }),
      ),
      "media/img1.png": strToU8("image-bytes"),
    });

    const back = await parseBookBundle(bundle); // must not throw
    const imgs = back.content!.t1.images ?? [];
    expect(imgs).toHaveLength(1);
    // Import mints a fresh id for every surviving image (closes a path-traversal
    // hole on the untrusted incoming id — see the "path traversal" test below),
    // so the surviving image's id is no longer the original "img1".
    expect(imgs[0].id).not.toBe("img1");
    expect(imgs[0].id).not.toBe("img-bad");
    expect(imgs[0].file).toMatch(new RegExp(`^media/${back.id}/[^/]+\\.png$`));
  });

  it("mints a fresh on-disk id for a bundle's untrusted image id, closing a path-traversal hole", async () => {
    const book = bookWithImage();
    const { zipSync, strToU8 } = jest.requireActual("fflate");
    // parseBook is structural-only, so a bundle's img.id is untrusted. A crafted
    // id like this must never reach the on-disk filename, or copyAsync would be
    // asked to write outside media/<newId>/.
    const maliciousImage = { ...book.content!.t1.images![0], id: "../../../../evil", file: "media/img1.png" };
    const bundle = zipSync({
      "book.json": strToU8(
        JSON.stringify({
          ...book,
          content: { t1: { ...book.content!.t1, images: [maliciousImage] } },
        }),
      ),
      "media/img1.png": strToU8("image-bytes"),
    });

    const back = await parseBookBundle(bundle);
    const imgs = back.content!.t1.images ?? [];
    expect(imgs).toHaveLength(1);
    // Fresh, generator-controlled uuid — no ".." segment, filename under the
    // new book's own media dir.
    expect(imgs[0].file).toMatch(new RegExp(`^media/${back.id}/[A-Za-z0-9_-]+\\.(jpg|png|webp)$`));
    expect(imgs[0].id).not.toMatch(/\.\./);

    // The actual write target handed to copyAsync must never contain a ".."
    // segment — this is the exact mechanism the traversal would have exploited.
    const copyCalls = (FileSystem.copyAsync as jest.Mock).mock.calls;
    expect(copyCalls.length).toBeGreaterThan(0);
    for (const [{ to }] of copyCalls) {
      expect(to).not.toMatch(/\.\./);
    }
  });

  it("drops a ref whose media entry exceeds the size cap", async () => {
    const book = bookWithImage();
    const { zipSync, strToU8 } = jest.requireActual("fflate");
    const oversized = new Uint8Array(11 * 1024 * 1024); // > MAX_IMAGE_BYTES (10 MiB)
    const bundle = zipSync({
      "book.json": strToU8(
        JSON.stringify({
          ...book,
          content: { t1: { ...book.content!.t1, images: [{ ...book.content!.t1.images![0], file: "media/img1.png" }] } },
        }),
      ),
      "media/img1.png": oversized,
    });
    const back = await parseBookBundle(bundle);
    expect(back.content!.t1.images ?? []).toHaveLength(0);
  });
});
