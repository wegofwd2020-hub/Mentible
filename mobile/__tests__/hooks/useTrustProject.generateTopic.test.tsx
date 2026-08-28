import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useTrustProject } from "@/hooks/useTrustProject";
import { DEFAULT_GENERATION_PARAMS } from "@/types/generationParams";

// Trust generation honors the user's SELECTED engine (Settings default params),
// not a hardcoded provider — so it defaults to the built-in engine but follows a
// user who picked Claude + saved a key.
const GEN_PROVIDER = DEFAULT_GENERATION_PARAMS.provider;

jest.mock("@/api/trustClient", () => ({
  getProject: jest.fn(),
  // Async per-topic generate (Phase A / T2): submit returns a job handle,
  // the shared GET /api/v1/jobs/{id} (polled via @/api/pollJob, over
  // global.fetch — see mockJobDone below) is polled until done|failed.
  generateTopic: jest.fn(),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: false }, loading: false }) }));
jest.mock("@/storage/settingsStore", () => ({ loadDefaultParams: jest.fn() }));

import * as tc from "@/api/trustClient";
import { loadDefaultParams } from "@/storage/settingsStore";

function mockJobDone(view: object) {
  const fn = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => view, text: async () => "",
    headers: { get: () => null },
  });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

describe("useTrustProject().generateTopic (async submit+poll)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: the user hasn't changed the engine → the built-in default provider.
    (loadDefaultParams as jest.Mock).mockResolvedValue({ ...DEFAULT_GENERATION_PARAMS });
    (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
    (tc.generateTopic as jest.Mock).mockResolvedValue({ job_id: "job-1", status: "queued" });
    mockJobDone({
      status: "done",
      result: { version_id: "tv1", topic_id: "t1", version_no: 1 },
    });
  });

  it("honors the user's selected provider (e.g. Claude) over the default engine", async () => {
    // User picked Anthropic in Settings → trust gen must use their choice + key,
    // not a hardcoded provider (the #495 regression: Claude selection ignored).
    (loadDefaultParams as jest.Mock).mockResolvedValue({
      ...DEFAULT_GENERATION_PARAMS,
      provider: "anthropic",
    });
    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await result.current.generateTopic("t1");

    const body = (tc.generateTopic as jest.Mock).mock.calls[0][2] as { provider_id: string };
    expect(body.provider_id).toBe("anthropic");
  });

  it("passes guidance through to the submit call when given", async () => {
    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await result.current.generateTopic("t1", { guidance: "tighten the intro" });

    expect(tc.generateTopic).toHaveBeenCalledWith(
      "p1",
      "t1",
      { api_key: "sk-ant-x", provider_id: GEN_PROVIDER, guidance: "tighten the intro" },
      "tok",
    );
  });

  it("omits guidance when no opts are given", async () => {
    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await result.current.generateTopic("t1");

    const call = (tc.generateTopic as jest.Mock).mock.calls[0];
    const body = call[2] as { guidance?: string };
    expect(body.guidance).toBeUndefined();
    expect(body).toMatchObject({ api_key: "sk-ant-x", provider_id: GEN_PROVIDER });
  });

  it("polls the shared jobs endpoint and, on done, resolves with the version shape and refreshes the project", async () => {
    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    const out = await result.current.generateTopic("t1");

    expect(out).toEqual({ id: "tv1", topic_id: "t1", version_no: 1, created_at: null });
    const mockFetch = (global as unknown as { fetch: jest.Mock }).fetch;
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/jobs\/job-1$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    // Initial mount load + the post-generate refresh.
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(2));
  });

  it("throws when the job comes back failed, without refreshing", async () => {
    mockJobDone({ status: "failed", error: "topic generation failed" });
    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await act(async () => {
      await expect(result.current.generateTopic("t1")).rejects.toThrow("topic generation failed");
    });
    expect(tc.getProject).toHaveBeenCalledTimes(1);
  });
});
