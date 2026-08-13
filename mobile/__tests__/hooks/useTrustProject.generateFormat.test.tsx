import { renderHook, waitFor } from "@testing-library/react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({
  getProject: jest.fn(),
  createArtifact: jest.fn(),
  generateVersion: jest.fn(),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: false }, loading: false }) }));

import * as tc from "@/api/trustClient";

// useGenerateVersionJob now polls the shared GET /api/v1/jobs/{id} via
// @/api/pollJob, which calls global.fetch directly (no more
// trustClient.getGenerateVersionJob) — mock fetch for the poll leg.
function mockJobDone(result: object) {
  const fn = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ status: "done", result }), text: async () => "",
    headers: { get: () => null },
  });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

describe("useTrustProject().generateFormat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  });

  it("creates an artifact for the chosen format then submits+polls a generate job", async () => {
    (tc.createArtifact as jest.Mock).mockResolvedValue({ id: "art1" });
    (tc.generateVersion as jest.Mock).mockResolvedValue({ job_id: "job-1", status: "queued" });
    const mockFetch = mockJobDone({ version_id: "v1", artifact_id: "art1", version_no: 1 });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    const v = await result.current.generateFormat({
      format: "linkedin",
      label: "LinkedIn post",
      hint: "180–260 words",
      role: "derivative",
    });

    expect(tc.createArtifact).toHaveBeenCalledWith(
      "p1",
      { role: "derivative", format: "linkedin", title: "LinkedIn post" },
      "tok",
    );
    expect(tc.generateVersion).toHaveBeenCalledWith(
      "art1",
      expect.objectContaining({ provider_id: "anthropic" }),
      "tok",
    );
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/jobs\/job-1$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(v).toEqual({ id: "v1", artifact_id: "art1", version_no: 1, created_at: null });
  });
});
