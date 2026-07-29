import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";
const proj = (my_role: string, is_validated = false, recorded_via: string | null = null) => ({
  project: { project: { id: "p1", title: "P", topic: null }, my_role,
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, is_validated, recorded_via }] }] },
  loading: false, error: null, refresh: jest.fn(), approve: jest.fn().mockResolvedValue({ recorded_via: "operator" }),
  addArtifact: jest.fn().mockResolvedValue({ id: "a2" }), addVersion: jest.fn().mockResolvedValue({ id: "v2" }), invite: jest.fn().mockResolvedValue({}),
});
beforeEach(() => jest.clearAllMocks());
it("owner sees Invite + Add-artifact actions; reviewer does not", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  const { rerender } = render(<TrustProjectDetail />);
  expect(await screen.findByLabelText("Invite an expert")).toBeTruthy();
  expect(screen.getByLabelText("Add an artifact")).toBeTruthy();
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer"));
  rerender(<TrustProjectDetail />);
  expect(screen.queryByLabelText("Invite an expert")).toBeNull();
});
it("shows the recorded_via chip on a validated version", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer", true, "expert_self"));
  render(<TrustProjectDetail />);
  expect(await screen.findByText(/expert-validated/i)).toBeTruthy();
});
