import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const base = {
  project: {
    project: { id: "p1", title: "Stormwater", topic: null },
    my_role: "owner",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, is_validated: false }] }],
  },
  loading: false, error: null, refresh: jest.fn(),
  approve: jest.fn(), addArtifact: jest.fn(), generateVersion: jest.fn(), invite: jest.fn(), addInput: jest.fn(),
  inputs: [],
};

beforeEach(() => { jest.clearAllMocks(); });

it("opens the version viewer when a Drafts version row is pressed", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(screen.getByLabelText("Open version 1"));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/trust/version/[versionId]",
    params: { versionId: "v1", artifactId: "art", projectId: "p1" },
  });
});

it("opens the version viewer when a Feedback version row is pressed", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  fireEvent.press(screen.getByLabelText("Open version 1"));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/trust/version/[versionId]",
    params: { versionId: "v1", artifactId: "art", projectId: "p1" },
  });
});
