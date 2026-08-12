import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// An owner can start a revision straight from a reviewer's note: a
// "Revise from this note" control on each feedback row prefills the existing
// guidance box with the note's body and opens it — the existing
// generateVersion submit then uses that guidance. Reviewers never see the
// control (only owners can revise). See task-2-brief.md.

let mockRole = "owner";
const mockGenerateVersion = jest.fn(async () => ({ id: "v3", artifact_id: "a1", version_no: 3, created_at: null }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole, inputs: [] },
    addVersion: jest.fn(),
    generateVersion: mockGenerateVersion,
    approve: jest.fn(),
    unapprove: jest.fn(),
  }),
}));
// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [{ id: "f1", version_id: "v1", author_kind: "expert", author_name: "Dr X", body: "tighten the intro", created_at: null }],
  })),
  addFeedback: jest.fn(),
}));

import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => {
  mockRole = "owner";
  mockGenerateVersion.mockClear();
});

it("owner: 'Revise from this note' prefills guidance and submits it", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  await waitFor(() => expect(screen.getByText("tighten the intro")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Revise from this note"));

  const guidanceInput = await waitFor(() => screen.getByLabelText("Regeneration guidance"));
  expect(guidanceInput.props.value).toContain("tighten the intro");

  fireEvent.press(screen.getByLabelText("Generate new version"));
  await waitFor(() =>
    expect(mockGenerateVersion).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ guidance: "tighten the intro", onPhase: expect.any(Function) }),
    ),
  );
});

it("reviewer: does not see 'Revise from this note'", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  await waitFor(() => expect(screen.getByText("tighten the intro")).toBeTruthy());
  expect(screen.queryByLabelText("Revise from this note")).toBeNull();
});
