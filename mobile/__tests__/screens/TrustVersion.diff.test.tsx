import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// "Changes from v(n-1)" toggle: shown only when the artifact's versions list
// (from useTrustProject's project) has an entry for version_no - 1. Collapsed
// by default; tapping it fetches the previous version via getVersion and
// renders a diffVersions summary row per section.

let mockArtifacts: { artifact: { id: string }; versions: { id: string; version_no: number; created_at: string | null; is_validated: boolean; recorded_via: string | null }[] }[] = [];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v2", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: "owner", inputs: [], artifacts: mockArtifacts },
    addVersion: jest.fn(),
    generateVersion: jest.fn(),
    approve: jest.fn(),
    unapprove: jest.fn(),
  }),
}));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));

const mockGetVersion = jest.fn(async (id: string, _token: string) => {
  if (id === "v1") {
    return {
      id: "v1", artifact_id: "a1", version_no: 1,
      content: {
        sections: [
          { heading: "Overview", body: "old overview", source_ids: [] },
        ],
      },
      generation_meta: null, is_validated: true, recorded_via: "expert_self", created_at: null,
      feedback: [],
    };
  }
  return {
    id: "v2", artifact_id: "a1", version_no: 2,
    content: {
      sections: [
        { heading: "Overview", body: "new overview", source_ids: [] },
        { heading: "New", body: "n", source_ids: [] },
      ],
    },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [],
  };
});
jest.mock("@/api/trustClient", () => ({
  getVersion: (id: string, token: string) => mockGetVersion(id, token),
  addFeedback: jest.fn(),
}));

import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => {
  mockGetVersion.mockClear();
  mockArtifacts = [
    {
      artifact: { id: "a1" },
      versions: [
        { id: "v2", version_no: 2, created_at: "2026-08-01T00:00:00Z", is_validated: false, recorded_via: null },
        { id: "v1", version_no: 1, created_at: "2026-07-01T00:00:00Z", is_validated: true, recorded_via: "expert_self" },
      ],
    },
  ];
});

it("shows a 'Changes from v1' control and renders the diff summary when tapped", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getAllByText("Overview").length).toBeGreaterThan(0));

  const toggle = screen.getByLabelText("Changes from v1");
  expect(toggle).toBeTruthy();

  // Collapsed by default — no diff rows yet, and prev not fetched.
  expect(screen.queryByText("~ Overview")).toBeNull();
  expect(mockGetVersion).not.toHaveBeenCalledWith("v1", "tok");

  fireEvent.press(toggle);

  await waitFor(() => expect(screen.getByText("~ Overview")).toBeTruthy());
  expect(screen.getByText("+ New")).toBeTruthy();
  expect(mockGetVersion).toHaveBeenCalledWith("v1", "tok");
});

it("hides the control when there is no previous version", async () => {
  mockArtifacts = [
    {
      artifact: { id: "a1" },
      versions: [{ id: "v2", version_no: 2, created_at: "2026-08-01T00:00:00Z", is_validated: false, recorded_via: null }],
    },
  ];
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getAllByText("Overview").length).toBeGreaterThan(0));

  expect(screen.queryByLabelText(/Changes from v/)).toBeNull();
});
