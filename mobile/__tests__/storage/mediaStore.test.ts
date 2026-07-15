import type { Book, TopicImage } from "@/types/book";

jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  // Default: existence is tracked by `files` (populated by copyAsync); size is
  // a fixed stub. Individual tests override getInfoAsync's implementation to
  // simulate the stripped file's real on-disk size, then restore this default.
  const defaultGetInfoAsync = async (p: string) => ({ exists: p in files, size: 1234, uri: p });
  return {
    documentDirectory: "file:///doc/",
    getInfoAsync: jest.fn(defaultGetInfoAsync),
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async ({ to }: { to: string }) => { files[to] = "COPIED"; }),
    deleteAsync: jest.fn(async (p: string) => { delete files[p]; }),
    readAsStringAsync: jest.fn(async () => "QUJD"), // base64 "ABC"
    readDirectoryAsync: jest.fn(async () => Object.keys(files).map((f) => f.split("/").pop()!)),
    __files: files,
    __defaultGetInfoAsync: defaultGetInfoAsync,
    EncodingType: { Base64: "base64" },
  };
});
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: uri + ".stripped", width: 10, height: 8 })),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

import * as FileSystem from "expo-file-system";
import {
  attachImage, deleteImage, resolveFigureDataUrls, pruneOrphanMedia, MediaCapError,
} from "@/storage/mediaStore";
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC, MAX_MEDIA_PER_BOOK_BYTES } from "@/storage/mediaPaths";

function bookWithTopic(): Book {
  return {
    id: "bk1", title: "T",
    toc: { subjects: [{ title: "S", units: [{ id: "t1", title: "U" }] }] } as any,
    createdAt: "x", updatedAt: "x",
    content: { t1: { topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x" } },
  };
}

function fakeImage(id: string, file: string): TopicImage {
  return { id, file, mime: "image/jpeg", addedAt: "x" };
}

afterEach(() => {
  // Restore defaults after tests that override a mock's implementation, so
  // overrides never leak into later tests regardless of run order.
  (FileSystem.getInfoAsync as jest.Mock).mockImplementation((FileSystem as any).__defaultGetInfoAsync);
  (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(async () => "QUJD");
  for (const k of Object.keys((FileSystem as any).__files)) delete (FileSystem as any).__files[k];
});

describe("mediaStore", () => {
  it("attaches an image: strips EXIF, writes a ref, bytes stay off the book", async () => {
    const book = await attachImage(bookWithTopic(), "t1", { uri: "file:///pick.jpg", mime: "image/jpeg", fileSize: 2000 });
    const imgs = book.content!.t1.images!;
    expect(imgs).toHaveLength(1);
    expect(imgs[0].file).toMatch(/^media\/bk1\/.+\.jpg$/);
    expect(JSON.stringify(book)).not.toContain("data:"); // refs only
  });

  it("rejects a disallowed mime", async () => {
    await expect(
      attachImage(bookWithTopic(), "t1", { uri: "file:///a.gif", mime: "image/gif" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects an oversize image (fileSize present, early-out)", async () => {
    await expect(
      attachImage(bookWithTopic(), "t1", { uri: "file:///big.jpg", mime: "image/jpeg", fileSize: MAX_IMAGE_BYTES + 1 }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("resolves refs to data: URLs", async () => {
    const book = await attachImage(bookWithTopic(), "t1", { uri: "file:///pick.png", mime: "image/png", fileSize: 10 });
    const map = await resolveFigureDataUrls(book.content!.t1);
    const url = [...map.values()][0];
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it("delete removes the ref", async () => {
    let book = await attachImage(bookWithTopic(), "t1", { uri: "file:///pick.png", mime: "image/png", fileSize: 10 });
    const id = book.content!.t1.images![0].id;
    book = await deleteImage(book, "t1", id);
    expect(book.content!.t1.images).toHaveLength(0);
  });

  it("rejects attaching to a topic already at MAX_IMAGES_PER_TOPIC", async () => {
    const book = bookWithTopic();
    book.content!.t1.images = Array.from({ length: MAX_IMAGES_PER_TOPIC }, (_, i) =>
      fakeImage(`img${i}`, `media/bk1/img${i}.jpg`),
    );
    await expect(
      attachImage(book, "t1", { uri: "file:///one-more.jpg", mime: "image/jpeg" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects when the real on-disk size would push the book over its media budget", async () => {
    const book = bookWithTopic();
    book.content!.t1.images = [fakeImage("existing", "media/bk1/existing.jpg")];
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => {
      if (p.endsWith("existing.jpg")) return { exists: true, size: MAX_MEDIA_PER_BOOK_BYTES - 100 };
      if (p.endsWith(".stripped")) return { exists: true, size: 200 };
      return { exists: false, size: 0 };
    });
    await expect(
      attachImage(book, "t1", { uri: "file:///new.jpg", mime: "image/jpeg" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects an oversize image by real on-disk size when fileSize is undefined", async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => {
      if (p.endsWith(".stripped")) return { exists: true, size: MAX_IMAGE_BYTES + 1 };
      return { exists: false, size: 0 };
    });
    await expect(
      attachImage(bookWithTopic(), "t1", { uri: "file:///big2.jpg", mime: "image/jpeg" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("resolveFigureDataUrls skips a missing file without throwing", async () => {
    const gen = {
      topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x",
      images: [fakeImage("present", "media/bk1/present.jpg"), fakeImage("missing", "media/bk1/missing.jpg")],
    };
    (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(async (p: string) => {
      if (p.endsWith("missing.jpg")) throw new Error("ENOENT");
      return "QUJD";
    });
    const map = await resolveFigureDataUrls(gen as any);
    expect(map.has("present")).toBe(true);
    expect(map.has("missing")).toBe(false);
  });

  it("pruneOrphanMedia deletes files not referenced by any surviving image", async () => {
    const book = bookWithTopic();
    book.content!.t1.images = [fakeImage("kept", "media/bk1/kept.jpg")];
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => ({ exists: true, size: 1234, uri: p }));
    (FileSystem as any).__files["file:///doc/media/bk1/kept.jpg"] = "COPIED";
    (FileSystem as any).__files["file:///doc/media/bk1/orphan.jpg"] = "COPIED";

    await pruneOrphanMedia(book);

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringContaining("orphan.jpg"), expect.anything(),
    );
    expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("kept.jpg"), expect.anything(),
    );
  });
});
