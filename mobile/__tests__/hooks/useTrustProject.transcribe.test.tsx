import { renderHook, waitFor } from "@testing-library/react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({
  getProject: jest.fn(),
  transcribeAudio: jest.fn(),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: false }, loading: false }) }));
jest.mock("@/storage/settingsStore", () => ({ loadDefaultParams: jest.fn() }));

import * as tc from "@/api/trustClient";
import { loadApiKey } from "@/secure/keyStore";
import { loadDefaultParams } from "@/storage/settingsStore";

const asset = { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 1 };

// pollJob polls GET /api/v1/jobs/{id} via global.fetch — mock a done job.
function mockJobDone(result: object) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: "done", result }),
    text: async () => "",
    headers: { get: () => null },
  });
}

describe("useTrustProject().transcribeAudio", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  });

  it("forwards a saved Groq key as BYOK STT (provider_id + api_key)", async () => {
    (loadDefaultParams as jest.Mock).mockResolvedValue({ provider: "groq", model: null });
    (loadApiKey as jest.Mock).mockResolvedValue("gsk-x");
    (tc.transcribeAudio as jest.Mock).mockResolvedValue({ job_id: "job-1", status: "queued" });
    mockJobDone({ artifact_id: "art1", version_id: "v1", version_no: 1 });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    const out = await result.current.transcribeAudio(asset, { title: "Interview 1" });

    expect(out).toEqual({ artifact_id: "art1", version_id: "v1", version_no: 1 });
    expect(tc.transcribeAudio).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ asset, language: "ta", title: "Interview 1", providerId: "groq", apiKey: "gsk-x" }),
      "tok",
    );
  });

  it("nudges a non-Pro user with no STT-capable key (anthropic gen provider)", async () => {
    (loadDefaultParams as jest.Mock).mockResolvedValue({ provider: "anthropic", model: null });
    (loadApiKey as jest.Mock).mockResolvedValue("sk-ant-x"); // not consulted for anthropic

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await expect(result.current.transcribeAudio(asset)).rejects.toThrow(/managed plan or a Groq\/OpenAI key/);
    expect(tc.transcribeAudio).not.toHaveBeenCalled();
  });
});
