import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/api/client", () => ({
  exportBook: jest.fn(),
  getExportJob: jest.fn(),
  getPublishedArtifacts: jest.fn(),
}));
jest.mock("@/storage/mediaStore", () => ({
  resolveFigureDataUrls: jest.fn(async (t: any) =>
    new Map((t.images ?? []).map((i: any) => [i.id, `data:${i.mime};base64,ZZ`])),
  ),
}));

import { exportBook, getExportJob, getPublishedArtifacts } from "@/api/client";
import { trackedExport, reconcileGeneratingExports, loadPublishedMap } from "@/lib/trackedExport";
import { getExportStatus, setFormatStatus } from "@/storage/exportStatus";
import type { Book } from "@/types/book";

const mockExport = exportBook as jest.Mock;
const mockGetJob = getExportJob as jest.Mock;
const mockGetPublished = getPublishedArtifacts as jest.Mock;

const book = (over: Partial<Book> = {}): Book => ({
  id: "b1",
  title: "T",
  toc: { subjects: [] },
  createdAt: "2026-07-04T09:00:00Z",
  updatedAt: "2026-07-04T10:00:00Z",
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("trackedExport", () => {
  it("records done (with size + source version) on success and passes onSubmitted", async () => {
    let submittedCb: ((id: string) => void) | undefined;
    mockExport.mockImplementation(async (_b, opts) => {
      submittedCb = opts.onSubmitted; // captured — exportBook wires the job id through it
      return { artifact: new ArrayBuffer(42), trust: undefined };
    });

    const res = await trackedExport(book(), "pdf", { diagrams: true });
    expect(res.artifact.byteLength).toBe(42);
    expect(typeof submittedCb).toBe("function");

    const s = await getExportStatus("b1");
    expect(s.pdf?.state).toBe("done");
    expect(s.pdf?.sizeBytes).toBe(42);
    expect(s.pdf?.sourceUpdatedAt).toBe("2026-07-04T10:00:00Z");
  });

  it("records failed and rethrows when the export throws", async () => {
    mockExport.mockRejectedValueOnce(new Error("The export could not be completed."));
    await expect(trackedExport(book(), "epub")).rejects.toThrow(/could not be completed/);
    const s = await getExportStatus("b1");
    expect(s.epub?.state).toBe("failed");
    expect(s.epub?.error).toMatch(/could not be completed/);
  });

  it("POSTs an inflated payload (Figures section) for a book with images, leaving the stored book untouched", async () => {
    mockExport.mockResolvedValueOnce({ artifact: new ArrayBuffer(1), trust: undefined });

    const withImages = book({
      content: {
        t1: {
          topicId: "t1",
          title: "U",
          generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          images: [{ id: "a", file: "media/b1/a.jpg", mime: "image/jpeg", caption: "Cap", addedAt: "x" }],
        },
      },
    });

    await trackedExport(withImages, "epub");

    expect(mockExport).toHaveBeenCalledTimes(1);
    const postedBook = mockExport.mock.calls[0][0] as Book;
    const secs = postedBook.content!.t1.lesson.sections;
    expect(secs.at(-1)!.heading).toBe("Figures");
    expect(secs.at(-1)!.body_markdown).toContain("data:image/jpeg;base64,ZZ");
    // stored book (the caller's reference) is never mutated:
    expect(withImages.content!.t1.lesson.sections).toHaveLength(1);
  });
});

describe("reconcileGeneratingExports", () => {
  it("settles a lingering generating row to done when its job finished", async () => {
    await setFormatStatus("b1", "pdf", {
      state: "generating",
      jobId: "j9",
      sourceUpdatedAt: "2026-07-04T10:00:00Z",
    });
    mockGetJob.mockResolvedValueOnce({ job_id: "j9", status: "done", size: 999 });

    await reconcileGeneratingExports();

    const s = await getExportStatus("b1");
    expect(s.pdf?.state).toBe("done");
    expect(s.pdf?.sizeBytes).toBe(999);
    expect(s.pdf?.sourceUpdatedAt).toBe("2026-07-04T10:00:00Z"); // preserved
  });

  it("settles to failed when the job failed", async () => {
    await setFormatStatus("b1", "epub", { state: "generating", jobId: "j8" });
    mockGetJob.mockResolvedValueOnce({ job_id: "j8", status: "failed", error: "boom" });
    await reconcileGeneratingExports();
    const s = await getExportStatus("b1");
    expect(s.epub?.state).toBe("failed");
    expect(s.epub?.error).toBe("boom");
  });

  it("leaves a still-running job as generating", async () => {
    await setFormatStatus("b1", "pdf", { state: "generating", jobId: "j7" });
    mockGetJob.mockResolvedValueOnce({ job_id: "j7", status: "running" });
    await reconcileGeneratingExports();
    expect((await getExportStatus("b1")).pdf?.state).toBe("generating");
  });

  it("does not poll for a done row", async () => {
    await setFormatStatus("b1", "epub", { state: "done", compiledAt: "x" });
    await reconcileGeneratingExports();
    expect(mockGetJob).not.toHaveBeenCalled();
  });
});

describe("loadPublishedMap", () => {
  it("maps each book to which formats are published", async () => {
    mockGetPublished.mockImplementation(async (id: string) =>
      id === "a" ? { epub: { size_bytes: 1 }, pdf: { size_bytes: 2 } } : { epub: { size_bytes: 1 } },
    );
    const map = await loadPublishedMap(["a", "b"]);
    expect(map).toEqual({ a: { epub: true, pdf: true }, b: { epub: true, pdf: false } });
  });

  it("maps a book to {} when its lookup fails (offline / unpublished)", async () => {
    mockGetPublished.mockRejectedValue(new Error("network"));
    expect(await loadPublishedMap(["x"])).toEqual({ x: {} });
  });
});
