import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/api/trustClient", () => ({
  suggestToc: jest.fn(),
  getSuggestTocJob: jest.fn(),
}));

import { suggestToc, getSuggestTocJob } from "@/api/trustClient";
import { useSuggestTocJob } from "@/hooks/useSuggestTocJob";

const mockSuggestToc = suggestToc as jest.Mock;
const mockGetSuggestTocJob = getSuggestTocJob as jest.Mock;

const toc = { subjects: [{ subject_label: "Unit 1", units: [] }] };

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

it("submits suggestToc then polls /jobs/{id} through queued -> running -> done, resolving with the toc", async () => {
  mockSuggestToc.mockResolvedValue({ job_id: "job-1", status: "queued" });
  const onPhase = jest.fn();
  mockGetSuggestTocJob
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValueOnce({ status: "running" })
    .mockResolvedValueOnce({ status: "done", result: { toc } });

  const { result } = renderHook(() => useSuggestTocJob(1));

  let out: unknown;
  await act(async () => {
    out = await result.current.run({ projectId: "p1", apiKey: "sk-ant-x", accessToken: "tok", onPhase });
  });

  expect(out).toEqual(toc);
  expect(result.current.status).toBe("done");
  expect(mockSuggestToc).toHaveBeenCalledWith("p1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok");
  expect(mockGetSuggestTocJob).toHaveBeenCalledTimes(3);
  expect(mockGetSuggestTocJob).toHaveBeenNthCalledWith(1, "job-1", "tok");
  expect(onPhase).toHaveBeenCalledWith("queued");
  expect(onPhase).toHaveBeenCalledWith("running");
});

it("throws and sets status/error to failed when the job resolves failed", async () => {
  mockSuggestToc.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockGetSuggestTocJob.mockResolvedValue({ status: "failed", error: "outline generation failed" });

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
  expect(mockGetSuggestTocJob).not.toHaveBeenCalled();
});
