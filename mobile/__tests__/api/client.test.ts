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
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([80, 75]).buffer, // "PK"
    });
    const { artifact, trust } = await exportBook(book);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/export?");
    expect(url).toContain("format=epub");
    expect(url).toContain("diagrams=false");
    expect(opts.method).toBe("POST");
    expect(new Uint8Array(artifact)[0]).toBe(80);
    expect(trust).toBeUndefined(); // no header → no manifest
  });

  it("passes format=pdf and diagrams=true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await exportBook(book, { format: "pdf", diagrams: true });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("format=pdf");
    expect(url).toContain("diagrams=true");
  });

  it("decodes the X-Content-Trust-Manifest header into a manifest (SBQ-TRUST-002)", async () => {
    const manifest = {
      trust_manifest_version: 1,
      provenance: { provider: "anthropic", model: "claude-sonnet-4-6", model_verified: true },
      validation: { schema_validated: true },
      compliance: {
        ruleset: "mentible-professional@1.0",
        checks_passed: 5,
        checks_total: 5,
        status: "pass",
      },
      integrity: { content_hash: "sha256:abc" },
    };
    const b64 = Buffer.from(JSON.stringify(manifest)).toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === "X-Content-Trust-Manifest" ? b64 : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const { trust } = await exportBook(book);
    expect(trust?.compliance?.checks_passed).toBe(5);
    expect(trust?.integrity?.content_hash).toBe("sha256:abc");
  });

  it("ignores a malformed trust header without failing the download", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "!!!not-base64-json!!!" },
      arrayBuffer: async () => new Uint8Array([80]).buffer,
    });
    const { artifact, trust } = await exportBook(book);
    expect(new Uint8Array(artifact)[0]).toBe(80);
    expect(trust).toBeUndefined();
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

// ── Rate limiting (SBQ-RL): 429 → friendly Retry-After messaging ───────────────

describe("ApiError.userMessage — 429 rate limit", () => {
  it("phrases a short Retry-After in seconds (burst guard)", () => {
    const msg = new ApiError(429, "", 15).userMessage();
    expect(msg).toContain("15 second");
    expect(msg.toLowerCase()).toContain("too fast");
  });

  it("uses singular 'second' for 1", () => {
    expect(new ApiError(429, "", 1).userMessage()).toContain("1 second.");
  });

  it("phrases a minutes-scale wait", () => {
    expect(new ApiError(429, "", 150).userMessage()).toContain("3 minute"); // ceil(2.5)
  });

  it("phrases a long wait as today's limit in hours (daily cap)", () => {
    const msg = new ApiError(429, "", 7200).userMessage(); // 2h
    expect(msg.toLowerCase()).toContain("today");
    expect(msg).toContain("2 hour");
  });

  it("falls back to a generic wait when Retry-After is absent", () => {
    expect(new ApiError(429, "").userMessage().toLowerCase()).toContain("wait a moment");
  });
});

describe("ApiError.userMessage — other statuses", () => {
  it("surfaces the server's detail string", () => {
    const body = JSON.stringify({ detail: "this book has no content" });
    expect(new ApiError(422, body).userMessage()).toBe("this book has no content");
  });

  it("falls back to a generic line when the body isn't JSON", () => {
    expect(new ApiError(500, "<html>oops</html>").userMessage()).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("submit — Retry-After capture", () => {
  it("captures the Retry-After header into ApiError.retryAfter on a 429", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: (h: string) => (h === "Retry-After" ? "42" : null) },
      text: async () => JSON.stringify({ detail: "rate limit exceeded; slow down" }),
    });

    await expect(
      submitGenerate({
        request_id: "r1",
        topic: "x",
        level: "high_school",
        language: "en",
        format: "lesson",
        api_key: "sk-ant-FAKE",
      }),
    ).rejects.toMatchObject({ status: 429, retryAfter: 42 });
  });
});
