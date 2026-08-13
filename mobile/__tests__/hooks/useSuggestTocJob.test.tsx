import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/api/trustClient", () => ({
  suggestToc: jest.fn(),
}));

import { suggestToc } from "@/api/trustClient";
import { useSuggestTocJob } from "@/hooks/useSuggestTocJob";

const mockSuggestToc = suggestToc as jest.Mock;

const toc = { subjects: [{ subject_label: "Unit 1", units: [] }] };

// The hook now polls the shared GET /api/v1/jobs/{id} via @/api/pollJob,
// which calls global.fetch directly (no more trustClient.getSuggestTocJob)
// — see __tests__/api/pollJob.test.ts for the poll-mechanics coverage
// (queued -> running -> done, timeout, failed, ApiError). Here we only mock
// fetch to drive the hook's own submit/status/message wiring.
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

it("submits suggestToc then polls /jobs/{id} through queued -> running -> done, resolving with the toc", async () => {
  mockSuggestToc.mockResolvedValue({ job_id: "job-1", status: "queued" });
  const onPhase = jest.fn();
  const mockFetch = mockJobSequence([
    { status: "queued" },
    { status: "running" },
    { status: "done", result: { toc } },
  ]);

  const { result } = renderHook(() => useSuggestTocJob(1));

  let out: unknown;
  await act(async () => {
    out = await result.current.run({ projectId: "p1", apiKey: "sk-ant-x", accessToken: "tok", onPhase });
  });

  expect(out).toEqual(toc);
  expect(result.current.status).toBe("done");
  expect(mockSuggestToc).toHaveBeenCalledWith("p1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok");
  expect(mockFetch).toHaveBeenCalledTimes(3);
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/jobs\/job-1$/);
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(onPhase).toHaveBeenCalledWith("queued");
  expect(onPhase).toHaveBeenCalledWith("running");
});

it("throws and sets status/error to failed when the job resolves failed", async () => {
  mockSuggestToc.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockJobSequence([{ status: "failed", error: "outline generation failed" }]);

  const { result } = renderHook(() => useSuggestTocJob(1));

  let caught: unknown;
  await act(async () => {
    try {
      await result.current.run({ projectId: "p1", apiKey: "sk-ant-x", accessToken: "tok" });
    } catch (e) {
      caught = e;
    }
  });

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("outline generation failed");
  expect(result.current.status).toBe("failed");
  expect(result.current.error).toBe("outline generation failed");
});

it("throws when the submit itself rejects (e.g. no key / network)", async () => {
  mockSuggestToc.mockRejectedValue(new Error("No API key saved."));
  const mockFetch = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

  const { result } = renderHook(() => useSuggestTocJob(1));

  let caught: unknown;
  await act(async () => {
    try {
      await result.current.run({ projectId: "p1", apiKey: "", accessToken: "tok" });
    } catch (e) {
      caught = e;
    }
  });

  expect((caught as Error).message).toBe("No API key saved.");
  expect(result.current.status).toBe("failed");
  expect(mockFetch).not.toHaveBeenCalled();
});
