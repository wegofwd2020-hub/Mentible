import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/api/trustClient", () => ({
  generateTopic: jest.fn(),
}));

import { generateTopic } from "@/api/trustClient";
import { useGenerateTopicJob } from "@/hooks/useGenerateTopicJob";

const mockGenerateTopic = generateTopic as jest.Mock;

// The hook now polls the shared GET /api/v1/jobs/{id} via @/api/pollJob,
// which calls global.fetch directly (no more trustClient.getJob) — see
// __tests__/api/pollJob.test.ts for the poll-mechanics coverage (queued ->
// running -> done, timeout, failed, ApiError). Here we only mock fetch to
// drive the hook's own submit/status/message wiring.
function mockJobSequence(views: object[]) {
  const fn = jest.fn();
  views.forEach((v) =>
    fn.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => v, text: async () => JSON.stringify(v),
      headers: { get: () => null },
    }),
  );
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

it("submits the generate then polls /jobs/{id} through queued -> running -> done, resolving with result", async () => {
  mockGenerateTopic.mockResolvedValue({ job_id: "job-1", status: "queued" });
  const mockFetch = mockJobSequence([
    { status: "queued" },
    { status: "running" },
    { status: "done", result: { version_id: "tv2", topic_id: "t1", version_no: 2 } },
  ]);

  const { result } = renderHook(() => useGenerateTopicJob(1));

  let out: unknown;
  await act(async () => {
    out = await result.current.run({
      projectId: "p1",
      topicId: "t1",
      apiKey: "sk-ant-x",
      accessToken: "tok",
    });
  });

  expect(out).toEqual({ version_id: "tv2", topic_id: "t1", version_no: 2 });
  expect(result.current.status).toBe("done");
  expect(mockGenerateTopic).toHaveBeenCalledWith(
    "p1", "t1", { api_key: "sk-ant-x", provider_id: "anthropic", guidance: undefined }, "tok",
  );
  expect(mockFetch).toHaveBeenCalledTimes(3);
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/jobs\/job-1$/);
  expect(init.headers.Authorization).toBe("Bearer tok");
});

it("passes guidance through to the submit call", async () => {
  mockGenerateTopic.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockJobSequence([{ status: "done", result: { version_id: "tv2", topic_id: "t1", version_no: 2 } }]);

  const { result } = renderHook(() => useGenerateTopicJob(1));
  await act(async () => {
    await result.current.run({ projectId: "p1", topicId: "t1", apiKey: "sk-ant-x", accessToken: "tok", guidance: "tighten the intro" });
  });

  expect(mockGenerateTopic).toHaveBeenCalledWith(
    "p1", "t1", { api_key: "sk-ant-x", provider_id: "anthropic", guidance: "tighten the intro" }, "tok",
  );
});

it("throws and sets status/error to failed when the job resolves failed", async () => {
  mockGenerateTopic.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockJobSequence([{ status: "failed", error: "topic generation failed" }]);

  const { result } = renderHook(() => useGenerateTopicJob(1));

  let caught: unknown;
  await act(async () => {
    try {
      await result.current.run({ projectId: "p1", topicId: "t1", apiKey: "sk-ant-x", accessToken: "tok" });
    } catch (e) {
      caught = e;
    }
  });

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("topic generation failed");
  expect(result.current.status).toBe("failed");
  expect(result.current.error).toBe("topic generation failed");
});

it("throws when the submit itself rejects (e.g. no key / network)", async () => {
  mockGenerateTopic.mockRejectedValue(new Error("No API key saved."));
  const mockFetch = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

  const { result } = renderHook(() => useGenerateTopicJob(1));

  let caught: unknown;
  await act(async () => {
    try {
      await result.current.run({ projectId: "p1", topicId: "t1", apiKey: "", accessToken: "tok" });
    } catch (e) {
      caught = e;
    }
  });

  expect((caught as Error).message).toBe("No API key saved.");
  expect(result.current.status).toBe("failed");
  expect(mockFetch).not.toHaveBeenCalled();
});
