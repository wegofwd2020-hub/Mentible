import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

// P0-2 slice C: the editor role can edit but not approve; the reviewer role
// can approve but not edit; the owner can do both. Locks the canEdit/canApprove
// split (derived from project.my_role) in place — see task-5-brief.md.

let mockRole = "owner";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole, inputs: [] },
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
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));
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

beforeEach(() => { mockRole = "owner"; });

it("editor sees the Edit control and not Approve", async () => {
  mockRole = "editor";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.getByLabelText("Edit draft")).toBeTruthy();
  expect(screen.queryByLabelText("Approve version 2")).toBeNull();
});

// Revise hits generate_version, which the backend (Task 4) kept owner-only
// (create_version — "Edit text" — is the one opened to owner+editor). An
// editor must not see Revise, or tapping it 403s.
it("editor does not see Revise (generate_version stayed owner-only on the backend)", async () => {
  mockRole = "editor";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.getByLabelText("Edit draft")).toBeTruthy();
  expect(screen.queryByLabelText("Revise draft")).toBeNull();
  expect(screen.queryByLabelText("Approve version 2")).toBeNull();
});

it("reviewer sees Approve and not the Edit control", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.getByLabelText("Approve version 2")).toBeTruthy();
  expect(screen.queryByLabelText("Edit draft")).toBeNull();
});

it("owner sees both Edit and Approve", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.getByLabelText("Edit draft")).toBeTruthy();
  expect(screen.getByLabelText("Approve version 2")).toBeTruthy();
});
