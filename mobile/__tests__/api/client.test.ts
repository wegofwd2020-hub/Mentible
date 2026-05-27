import {
  ApiError,
  exportBook,
  getJobStatus,
  pollUntilDone,
  submitGenerate,
} from "../../src/api/client";
import type { Book } from "../../src/types/book";

global.fetch = jest.fn();

const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("submitGenerate", () => {
  it("posts to /api/v1/generate and returns job_id + status", async () => {
    mockResponse({ job_id: "abc-123", status: "queued" });

    const result = await submitGenerate({
      request_id: "req-1",
      topic: "Photosynthesis",
      level: "high_school",
      language: "en",
      format: "lesson",
      api_key: "sk-ant-FAKE",
    });

    expect(result.job_id).toBe("abc-123");
    expect(result.status).toBe("queued");

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/generate");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.topic).toBe("Photosynthesis");
    expect(body.api_key).toBe("sk-ant-FAKE");
  });

  it("throws ApiError on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "Unprocessable entity",
    });

    await expect(
      submitGenerate({
        request_id: "req-2",
        topic: "",
        level: "high_school",
        language: "en",
        format: "lesson",
        api_key: "sk-ant-FAKE",
      }),
    ).rejects.toThrow(ApiError);
  });
});

describe("getJobStatus", () => {
  it("returns job response for a known job id", async () => {
    mockResponse({ job_id: "abc-123", status: "running" });

    const res = await getJobStatus("abc-123");
    expect(res.status).toBe("running");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/jobs/abc-123");
  });
});

describe("pollUntilDone", () => {
  it("resolves when status transitions to done", async () => {
    mockResponse({ job_id: "j1", status: "queued" });
    mockResponse({ job_id: "j1", status: "running" });
    mockResponse({
      job_id: "j1",
      status: "done",
      result: {
        topic: "Algebra",
        level: "high_school",
        language: "en",
        synopsis: "...",
        learning_objectives: ["a"],
        sections: [{ heading: "h", body_markdown: "b" }],
        key_takeaways: ["k"],
        further_reading: [],
      },
    });

    const ticks: string[] = [];
    const job = await pollUntilDone("j1", (j) => ticks.push(j.status), 0);

    expect(job.status).toBe("done");
    expect(job.result?.topic).toBe("Algebra");
    expect(ticks).toEqual(["queued", "running", "done"]);
  });

  it("resolves with failed status when generation fails", async () => {
    mockResponse({ job_id: "j2", status: "failed", error: "Anthropic call failed" });

    const job = await pollUntilDone("j2", undefined, 0);
    expect(job.status).toBe("failed");
    expect(job.error).toBe("Anthropic call failed");
  });

  it("rejects when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(pollUntilDone("j3", undefined, 0)).rejects.toThrow("Network error");
  });
});

describe("exportBook", () => {
  const book = { id: "b1", title: "T", toc: { subjects: [] }, createdAt: "", updatedAt: "" } as Book;

  it("posts the book and defaults to format=epub, diagrams=false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([80, 75]).buffer, // "PK"
    });
    const bytes = await exportBook(book);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/export?");
    expect(url).toContain("format=epub");
    expect(url).toContain("diagrams=false");
    expect(opts.method).toBe("POST");
    expect(new Uint8Array(bytes)[0]).toBe(80);
  });

  it("passes format=pdf and diagrams=true", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    await exportBook(book, { format: "pdf", diagrams: true });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("format=pdf");
    expect(url).toContain("diagrams=true");
  });

  it("throws ApiError on non-2xx (e.g. 422 no content)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => '{"detail":"Book has no generated content to compile."}',
    });
    await expect(exportBook(book)).rejects.toBeInstanceOf(ApiError);
  });
});
