import type { Book } from "@/types/book";

jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  return {
    documentDirectory: "file:///doc/",
    getInfoAsync: jest.fn(async (p: string) => ({ exists: p in files, size: 1234, uri: p })),
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async ({ to }: { to: string }) => { files[to] = "COPIED"; }),
    deleteAsync: jest.fn(async (p: string) => { delete files[p]; }),
    readAsStringAsync: jest.fn(async () => "QUJD"), // base64 "ABC"
    readDirectoryAsync: jest.fn(async () => Object.keys(files).map((f) => f.split("/").pop()!)),
    __files: files,
    EncodingType: { Base64: "base64" },
  };
});
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: uri + ".stripped", width: 10, height: 8 })),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

import { attachImage, deleteImage, resolveFigureDataUrls, MediaCapError } from "@/storage/mediaStore";
import { MAX_IMAGE_BYTES } from "@/storage/mediaPaths";

function bookWithTopic(): Book {
  return {
    id: "bk1", title: "T",
    toc: { subjects: [{ title: "S", units: [{ id: "t1", title: "U" }] }] } as any,
    createdAt: "x", updatedAt: "x",
    content: { t1: { topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x" } },
  };
}

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

  it("rejects an oversize image", async () => {
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
});
