import { act, renderHook } from "@testing-library/react-native";
import { useTranscribeJob } from "@/hooks/useTranscribeJob";
import { transcribeAudio } from "@/api/trustClient";
import { pollJob } from "@/api/pollJob";

jest.mock("@/api/trustClient", () => ({
  transcribeAudio: jest.fn(),
}));
jest.mock("@/api/pollJob", () => ({
  pollJob: jest.fn(),
}));
jest.mock("@/api/client", () => ({ ApiError: class extends Error {} }));

const asset = { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 1 };

describe("useTranscribeJob", () => {
  beforeEach(() => {
    (transcribeAudio as jest.Mock).mockResolvedValue({ job_id: "j1", status: "queued" });
    (pollJob as jest.Mock).mockResolvedValue({ artifact_id: "a1", version_id: "v1", version_no: 1 });
  });

  it("submits then polls and resolves the transcript version", async () => {
    const { result } = renderHook(() => useTranscribeJob(1));
    let out;
    await act(async () => {
      out = await result.current.run({ projectId: "p1", asset, language: "ta", accessToken: "tok" });
    });
    expect(out).toEqual({ artifact_id: "a1", version_id: "v1", version_no: 1 });
    expect(result.current.status).toBe("done");
    expect(transcribeAudio).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ asset, language: "ta" }),
      "tok",
    );
  });

  it("sets failed status and rethrows on a poll failure", async () => {
    (pollJob as jest.Mock).mockRejectedValue(new Error("Transcription failed"));
    const { result } = renderHook(() => useTranscribeJob(1));
    await act(async () => {
      await expect(
        result.current.run({ projectId: "p1", asset, language: "ta", accessToken: "tok" }),
      ).rejects.toThrow("Transcription failed");
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("Transcription failed");
  });
});
