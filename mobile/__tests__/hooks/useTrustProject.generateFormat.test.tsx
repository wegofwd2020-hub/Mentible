import { renderHook, waitFor } from "@testing-library/react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({
  getProject: jest.fn(),
  createArtifact: jest.fn(),
  generateVersion: jest.fn(),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));

import * as tc from "@/api/trustClient";

describe("useTrustProject().generateFormat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  });

  it("creates an artifact for the chosen format then generates a version", async () => {
    (tc.createArtifact as jest.Mock).mockResolvedValue({ id: "art1" });
    (tc.generateVersion as jest.Mock).mockResolvedValue({ id: "v1", content: {} });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await result.current.generateFormat({
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
  });
});
