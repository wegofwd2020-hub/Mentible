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
it("owner sees the Invite action on Feedback; reviewer does not", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  const { rerender } = render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(screen.getByLabelText("Invite an expert")).toBeTruthy();
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer"));
  rerender(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(screen.queryByLabelText("Invite an expert")).toBeNull();
});
it("owner sees the generate picker on Drafts when there are no artifacts yet", async () => {
  const noArtifacts = proj("owner");
  (useTrustProject as jest.Mock).mockReturnValue({
    ...noArtifacts,
    project: { ...noArtifacts.project, artifacts: [] },
  });
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  expect(screen.getByText("LinkedIn post")).toBeTruthy();
  // No sources on this fixture, so the picker is disabled with its hint.
  expect(screen.getByText(/add a source first/i)).toBeTruthy();
});
it("shows the recorded_via chip on a validated version (Feedback)", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer", true, "expert_self"));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(await screen.findByText(/expert-validated/i)).toBeTruthy();
});
