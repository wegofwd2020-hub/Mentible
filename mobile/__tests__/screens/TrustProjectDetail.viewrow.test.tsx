import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const base = {
  project: {
    project: { id: "p1", title: "Stormwater", topic: null },
    my_role: "owner",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, created_at: "2026-08-04T14:14:00Z", is_validated: false, recorded_via: null }] }],
  },
  loading: false, error: null, refresh: jest.fn(),
  approve: jest.fn(), addArtifact: jest.fn(), generateVersion: jest.fn(), invite: jest.fn(), addInput: jest.fn(),
  inputs: [],
};

beforeEach(() => { jest.clearAllMocks(); });

it("shows a timestamp and an explicit View control on a Drafts version row", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  expect(screen.getByText(/v1/)).toBeTruthy();
  // timestamp shown
  expect(screen.getByText(/2026|AM|PM|:/)).toBeTruthy();
  // explicit View affordance opens the viewer
  fireEvent.press(screen.getByLabelText("View version 1"));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
    pathname: "/trust/version/[versionId]",
    params: expect.objectContaining({ versionId: "v1" }),
  }));
});
