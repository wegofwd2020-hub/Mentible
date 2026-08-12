import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Inline version history: when the current artifact (matched by artifactId)
// has more than one version, a "Versions" block renders above the Back
// button — one row per version (v{n}, date, a checkmark when validated, a
// "current" marker on the route's versionId) — and tapping a non-current row
// navigates via router.push, mirroring DraftsPanel's onOpenVersion. With one
// version (or no matching artifact) nothing renders — see task-3-brief.md.

const mockPush = jest.fn();
let mockArtifacts: { artifact: { id: string }; versions: { id: string; version_no: number; created_at: string | null; is_validated: boolean; recorded_via: string | null }[] }[] = [];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
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
// This screen renders through TopicRenderer (T3), whose native branch pulls
// in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [],
  })),
  addFeedback: jest.fn(),
}));

import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => {
  mockPush.mockClear();
  mockArtifacts = [];
});

it("renders a Versions block with both versions and marks the current one", async () => {
  mockArtifacts = [
    {
      artifact: { id: "a1" },
      versions: [
        { id: "v1", version_no: 2, created_at: "2026-08-01T00:00:00Z", is_validated: false, recorded_via: null },
        { id: "v0", version_no: 1, created_at: "2026-07-01T00:00:00Z", is_validated: true, recorded_via: "expert_self" },
      ],
    },
  ];
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  expect(screen.getByText("Versions")).toBeTruthy();
  expect(screen.getAllByText(/^v2/).length).toBeGreaterThan(0);
  expect(screen.getByText(/^v1/)).toBeTruthy();
  expect(screen.getByText("current")).toBeTruthy();
});

it("tapping a non-current version row navigates via router.push", async () => {
  mockArtifacts = [
    {
      artifact: { id: "a1" },
      versions: [
        { id: "v1", version_no: 2, created_at: "2026-08-01T00:00:00Z", is_validated: false, recorded_via: null },
        { id: "v0", version_no: 1, created_at: "2026-07-01T00:00:00Z", is_validated: true, recorded_via: "expert_self" },
      ],
    },
  ];
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Open version 1"));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/trust/version/[versionId]",
    params: { versionId: "v0", artifactId: "a1", projectId: "p1" },
  });
});

it("renders nothing when there is only one version", async () => {
  mockArtifacts = [
    {
      artifact: { id: "a1" },
      versions: [{ id: "v1", version_no: 2, created_at: "2026-08-01T00:00:00Z", is_validated: false, recorded_via: null }],
    },
  ];
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.queryByText("Versions")).toBeNull();
});

it("renders nothing when no artifact matches artifactId (defensive)", async () => {
  mockArtifacts = [];
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.queryByText("Versions")).toBeNull();
});
