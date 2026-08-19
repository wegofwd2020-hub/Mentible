jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  return {
    documentDirectory: "file:///doc/",
    cacheDirectory: "file:///cache/",
    getInfoAsync: jest.fn(async (p: string) => ({ exists: p in files, size: (files[p] ?? "").length, uri: p })),
    makeDirectoryAsync: jest.fn(async () => {}),
    writeAsStringAsync: jest.fn(async (uri: string, data: string) => { files[uri] = data; }),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      files[to] = files[from] ?? "COPIED";
    }),
    deleteAsync: jest.fn(async (p: string) => { delete files[p]; }),
    readAsStringAsync: jest.fn(async (p: string) => files[p] ?? "QUJD"),
    EncodingType: { Base64: "base64" },
    __files: files,
  };
});

jest.mock("@/api/derivativesClient", () => ({
  makeAudio: jest.fn(),
}));

import * as FileSystem from "expo-file-system";
import { makeAudio } from "@/api/derivativesClient";
import { generateAndStoreTopicAudio, AudioGenerateError } from "@/lib/audioGenerate";
import type { Book } from "@/types/book";

function bookWithTopic(): Book {
  return {
    id: "bk1", title: "T",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "U" }] }] },
    createdAt: "x", updatedAt: "x",
    content: { t1: { topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x" } },
  } as unknown as Book;
}

afterEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys((FileSystem as any).__files)) delete (FileSystem as any).__files[k];
});

describe("generateAndStoreTopicAudio", () => {
  it("calls makeAudio, stores the bytes, and returns a ref carrying the transcript", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "Hello there.", title: "Intro Narration",
      audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    const book = bookWithTopic();
    const { book: next, audio } = await generateAndStoreTopicAudio({
      book, topicId: "t1", source_text: "Some lesson text.", apiKey: "sk-test",
    });
    expect(makeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ source_text: "Some lesson text.", api_key: "sk-test" }),
    );
    expect(audio.title).toBe("Intro Narration");
    expect(audio.transcript).toBe("Hello there.");
    expect(audio.mime).toBe("audio/mpeg");
    expect(next.content!.t1.audio).toHaveLength(1);
    expect(next.content!.t1.audio![0].id).toBe(audio.id);
    // original book untouched — fail-open / no-mutation invariant
    expect(book.content!.t1.audio).toBeUndefined();
  });

  it("never sends api_key when the caller omits it (keyless managed-plan request)", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "s", title: "t", audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    await generateAndStoreTopicAudio({ book: bookWithTopic(), topicId: "t1", source_text: "x" });
    const call = (makeAudio as jest.Mock).mock.calls[0][0];
    expect(call).not.toHaveProperty("api_key");
  });

  it("cleans up its temp file after a successful write", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "s", title: "t", audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    await generateAndStoreTopicAudio({ book: bookWithTopic(), topicId: "t1", source_text: "x" });
    const tmp = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][0];
    expect((FileSystem as any).__files[tmp]).toBeUndefined();
  });

  it("fails open on a makeAudio error: throws AudioGenerateError, never touches the book", async () => {
    (makeAudio as jest.Mock).mockRejectedValue(new Error("503 upstream"));
    const book = bookWithTopic();
    await expect(
      generateAndStoreTopicAudio({ book, topicId: "t1", source_text: "x" }),
    ).rejects.toBeInstanceOf(AudioGenerateError);
    expect(book.content!.t1.audio).toBeUndefined();
  });

  it("fails open on a write error (e.g. disk full): throws a clear error, book not corrupted", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "s", title: "t", audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    (FileSystem.copyAsync as jest.Mock).mockRejectedValueOnce(new Error("ENOSPC"));
    const book = bookWithTopic();
    await expect(
      generateAndStoreTopicAudio({ book, topicId: "t1", source_text: "x" }),
    ).rejects.toBeInstanceOf(AudioGenerateError);
    expect(book.content!.t1.audio).toBeUndefined();
  });
});
