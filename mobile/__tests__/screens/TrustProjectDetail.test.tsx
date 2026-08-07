import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: mockPush }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
import { useTrustProject } from "@/hooks/useTrustProject";

const base = {
  project: { project: { id: "p1", title: "Stormwater", topic: null }, my_role: "reviewer",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, is_validated: true, recorded_via: "expert_self" }, { id: "v2", version_no: 2, is_validated: false }] }] },
  loading: false, error: null, refresh: jest.fn(),
};

beforeEach(() => { jest.clearAllMocks(); });

it("Feedback shows validated + awaiting states and opens a version to review", async () => {
  // Approve/Unapprove now lives on the draft view (slice 2) — Feedback lists
  // versions and opens each one; there is no inline Approve button here.
  (useTrustProject as jest.Mock).mockReturnValue({ ...base });
  render(<TrustProjectDetail />);
  expect(await screen.findByText("Stormwater")).toBeTruthy();
  fireEvent.press(screen.getByLabelText(/Feedback:/));
  expect(screen.getByLabelText("Version 1 validated")).toBeTruthy();
  expect(screen.queryByLabelText("Approve version 2")).toBeNull();
  fireEvent.press(screen.getByLabelText("Open version 2"));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ versionId: "v2" }) }));
});
