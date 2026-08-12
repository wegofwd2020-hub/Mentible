import { renderHook, waitFor } from "@testing-library/react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({
  getProject: jest.fn(),
  generateTopic: jest.fn(),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));

import * as tc from "@/api/trustClient";

describe("useTrustProject().generateTopic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
    (tc.generateTopic as jest.Mock).mockResolvedValue({ id: "tv1", topic_id: "t1", version_no: 1, created_at: null });
  });

  it("passes guidance through to the client call when given", async () => {
    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await result.current.generateTopic("t1", { guidance: "tighten the intro" });

    expect(tc.generateTopic).toHaveBeenCalledWith(
      "p1",
      "t1",
      { api_key: "sk-ant-x", provider_id: "anthropic", guidance: "tighten the intro" },
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
    expect(body).toMatchObject({ api_key: "sk-ant-x", provider_id: "anthropic" });
  });
});
