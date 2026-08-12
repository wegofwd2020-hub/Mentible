import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

// Owner vs reviewer see different revise controls: owner gets a primary
// "Revise" (+ secondary "Edit text") action that opens the guidance box and
// creates a new version via generateVersion; reviewer gets a note-only
// "Request a revision…" box that only files feedback for the owner to act on.
// This test locks that split in place — see task-1-brief.md.

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
// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));
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

it("owner sees a primary Revise + secondary Edit text, and no note box", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.getByLabelText("Revise draft")).toBeTruthy();
  expect(screen.getByText("Revise")).toBeTruthy();
  expect(screen.getByText("Edit text")).toBeTruthy();
  expect(screen.queryByPlaceholderText("Request a revision…")).toBeNull();
});

it("owner's Revise is styled as the secondary control (same bucket as Edit text), leaving Approve the single filled primary", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  const revise = screen.getByLabelText("Revise draft");
  const editText = screen.getByLabelText("Edit draft");
  const approve = screen.getByLabelText(`Approve version 2`);

  // Revise shares the secondary "Edit text" style, and NOT the filled
  // approve style — this is the two-pill fix (no color-literal asserts).
  expect(revise.props.style).toEqual(editText.props.style);
  expect(revise.props.style).not.toEqual(approve.props.style);
  expect(approve).toBeTruthy();
});

it("reviewer sees the note box and no Revise/Edit controls", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  expect(screen.getByPlaceholderText("Request a revision…")).toBeTruthy();
  expect(screen.queryByLabelText("Revise draft")).toBeNull();
  expect(screen.queryByLabelText("Edit draft")).toBeNull();
  expect(screen.queryByText("Revise")).toBeNull();
  expect(screen.queryByText("Edit text")).toBeNull();
});
