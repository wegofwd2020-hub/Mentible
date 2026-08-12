import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/api/trustClient", () => ({
  generateTopic: jest.fn(),
  getJob: jest.fn(),
}));

import { generateTopic, getJob } from "@/api/trustClient";
import { useGenerateTopicJob } from "@/hooks/useGenerateTopicJob";

const mockGenerateTopic = generateTopic as jest.Mock;
const mockGetJob = getJob as jest.Mock;

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

it("submits the generate then polls /jobs/{id} through queued -> running -> done, resolving with result", async () => {
  mockGenerateTopic.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockGetJob
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValueOnce({ status: "running" })
    .mockResolvedValueOnce({ status: "done", result: { version_id: "tv2", topic_id: "t1", version_no: 2 } });

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
  expect(mockGetJob).toHaveBeenCalledTimes(3);
  expect(mockGetJob).toHaveBeenNthCalledWith(1, "job-1", "tok");
});

it("passes guidance through to the submit call", async () => {
  mockGenerateTopic.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockGetJob.mockResolvedValue({ status: "done", result: { version_id: "tv2", topic_id: "t1", version_no: 2 } });

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
  mockGetJob.mockResolvedValue({ status: "failed", error: "topic generation failed" });

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
  expect(mockGetJob).not.toHaveBeenCalled();
});
