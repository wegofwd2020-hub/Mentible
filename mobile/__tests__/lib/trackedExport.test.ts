import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/api/client", () => ({
  exportBook: jest.fn(),
  getExportJob: jest.fn(),
}));

import { exportBook, getExportJob } from "@/api/client";
import { trackedExport, reconcileGeneratingExports } from "@/lib/trackedExport";
import { getExportStatus, setFormatStatus } from "@/storage/exportStatus";
import type { Book } from "@/types/book";

const mockExport = exportBook as jest.Mock;
const mockGetJob = getExportJob as jest.Mock;

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
