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
      versions: [
        { id: "v1", version_no: 1, created_at: "2026-08-04T14:14:00Z", is_validated: false, recorded_via: null },
        { id: "v2", version_no: 2, created_at: "2026-08-04T15:14:00Z", is_validated: false, recorded_via: null },
        { id: "v3", version_no: 3, created_at: "2026-08-04T16:14:00Z", is_validated: false, recorded_via: null },
      ] }],
  },
  loading: false, error: null, refresh: jest.fn(),
  approve: jest.fn(), addArtifact: jest.fn(), generateVersion: jest.fn(), invite: jest.fn(), addInput: jest.fn(),
  loadVersionContent: jest.fn(), generateFormat: jest.fn(),
  inputs: [],
};

beforeEach(() => { jest.clearAllMocks(); });

it("selects exactly 2 versions of an artifact and pushes the compare route", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  fireEvent.press(screen.getByLabelText("Compare versions"));

  // disabled until 2 selected
  fireEvent.press(screen.getByLabelText("Select version 2"));
  fireEvent.press(screen.getByLabelText("Compare selected versions"));
  expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: "/trust/compare/[versionId]" }));

  fireEvent.press(screen.getByLabelText("Select version 3"));
  fireEvent.press(screen.getByLabelText("Compare selected versions"));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
    pathname: "/trust/compare/[versionId]",
    params: expect.objectContaining({ versionId: "v2", b: "v3", artifactId: expect.any(String), projectId: expect.any(String) }),
  }));
});

it("checking a compare checkbox does not also navigate to the version viewer", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));

  fireEvent.press(screen.getByLabelText("Compare versions"));
  fireEvent.press(screen.getByLabelText("Select version 2"));

  // Guards the react-native-web bubbling defect: the checkbox is nested
  // inside the version-row Pressable, whose onPress opens the version
  // viewer. Checking a box must never also trigger onOpenVersion.
  expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({
    pathname: "/trust/version/[versionId]",
  }));
});
