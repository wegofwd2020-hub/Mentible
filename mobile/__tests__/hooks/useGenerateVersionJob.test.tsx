import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/api/trustClient", () => ({
  generateVersion: jest.fn(),
  getGenerateVersionJob: jest.fn(),
}));

import { generateVersion, getGenerateVersionJob } from "@/api/trustClient";
import { useGenerateVersionJob } from "@/hooks/useGenerateVersionJob";

const mockGenerateVersion = generateVersion as jest.Mock;
const mockGetGenerateVersionJob = getGenerateVersionJob as jest.Mock;

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

it("submits the generate then polls /jobs/{id} through queued -> running -> done, resolving with the reconstructed version", async () => {
  mockGenerateVersion.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockGetGenerateVersionJob
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValueOnce({ status: "running" })
    .mockResolvedValueOnce({ status: "done", result: { version_id: "v2", artifact_id: "a1", version_no: 2 } });

  const onPhase = jest.fn();
  const { result } = renderHook(() => useGenerateVersionJob(1));

  let out: unknown;
  await act(async () => {
    out = await result.current.run({
      artifactId: "a1",
      apiKey: "sk-ant-x",
      accessToken: "tok",
      onPhase,
    });
  });

  expect(out).toEqual({ id: "v2", artifact_id: "a1", version_no: 2, created_at: null });
  expect(result.current.status).toBe("done");
  expect(mockGenerateVersion).toHaveBeenCalledWith(
    "a1", { api_key: "sk-ant-x", provider_id: "anthropic", guidance: undefined }, "tok",
  );
  expect(mockGetGenerateVersionJob).toHaveBeenCalledTimes(3);
  expect(mockGetGenerateVersionJob).toHaveBeenNthCalledWith(1, "job-1", "tok");
  expect(onPhase).toHaveBeenCalledWith("queued");
  expect(onPhase).toHaveBeenCalledWith("running");
});

it("passes guidance through to the submit call", async () => {
  mockGenerateVersion.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockGetGenerateVersionJob.mockResolvedValue({ status: "done", result: { version_id: "v2", artifact_id: "a1", version_no: 2 } });

  const { result } = renderHook(() => useGenerateVersionJob(1));
  await act(async () => {
    await result.current.run({ artifactId: "a1", apiKey: "sk-ant-x", accessToken: "tok", guidance: "tighten the intro" });
  });

  expect(mockGenerateVersion).toHaveBeenCalledWith(
    "a1", { api_key: "sk-ant-x", provider_id: "anthropic", guidance: "tighten the intro" }, "tok",
  );
});

it("throws and sets status/error to failed when the job resolves failed", async () => {
  mockGenerateVersion.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockGetGenerateVersionJob.mockResolvedValue({ status: "failed", error: "generation failed" });

  const { result } = renderHook(() => useGenerateVersionJob(1));

  let caught: unknown;
  await act(async () => {
    try {
      await result.current.run({ artifactId: "a1", apiKey: "sk-ant-x", accessToken: "tok" });
    } catch (e) {
      caught = e;
    }
  });

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("generation failed");
  expect(result.current.status).toBe("failed");
  expect(result.current.error).toBe("generation failed");
});

it("throws when the submit itself rejects (e.g. no key / network)", async () => {
  mockGenerateVersion.mockRejectedValue(new Error("No API key saved."));

  const { result } = renderHook(() => useGenerateVersionJob(1));

  let caught: unknown;
  await act(async () => {
    try {
      await result.current.run({ artifactId: "a1", apiKey: "", accessToken: "tok" });
    } catch (e) {
      caught = e;
    }
  });

  expect((caught as Error).message).toBe("No API key saved.");
  expect(result.current.status).toBe("failed");
  expect(mockGetGenerateVersionJob).not.toHaveBeenCalled();
});
