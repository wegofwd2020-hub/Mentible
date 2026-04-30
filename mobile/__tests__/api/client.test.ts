import { ApiError, getJobStatus, pollUntilDone, submitGenerate } from "../../src/api/client";

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
