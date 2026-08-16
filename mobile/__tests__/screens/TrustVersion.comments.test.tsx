import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "reviewer", inputs: [] }, addVersion: jest.fn(), generateVersion: jest.fn(), approve: jest.fn(), unapprove: jest.fn() }),
}));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
// This screen renders through TopicRenderer (T3), whose native branch pulls
// in react-native-webview — stub it (see TrustVersion.feedback.test.tsx).
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));

const mockAddFeedback = jest.fn(async (_id: string, _body: { body: string; section_index?: number | null }, _token: string) => ({
  id: "f3", version_id: "v1", author_kind: "expert", author_name: "Dr X", body: "new comment", created_at: null, section_index: 0,
}));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: {
      sections: [
        { heading: "Enrollment", body: "Body one.", source_ids: [] },
        { heading: "Refunds", body: "Body two.", source_ids: [] },
      ],
    },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [
      { id: "f1", version_id: "v1", author_kind: "expert", author_name: "Dr X", body: "tighten this section", created_at: null, section_index: 0 },
      { id: "f2", version_id: "v1", author_kind: "operator", author_name: "Owner", body: "whole-version note", created_at: null, section_index: null },
    ],
  })),
  addFeedback: (id: string, body: { body: string; section_index?: number | null }, token: string) => mockAddFeedback(id, body, token),
}));

import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => jest.clearAllMocks());

it("renders the section-0 comment near the section-0 heading, and the whole-version note in Revision notes", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getAllByText("Enrollment").length).toBeGreaterThan(0));

  // Anchored comment shows up under its section, not in Revision notes.
  expect(screen.getByText("tighten this section")).toBeTruthy();

  // Revision notes only holds the whole-version (section_index: null) note.
  expect(screen.getByText("whole-version note")).toBeTruthy();
  expect(screen.queryByText("No revision notes yet.")).toBeNull();
});

it("Comment on a section posts feedback with that section's index", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Comment on section 2")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Comment on section 2"));
  fireEvent.changeText(screen.getByLabelText("Comment on section 2 body"), "add a citation here");
  fireEvent.press(screen.getByLabelText("Submit comment on section 2"));

  await waitFor(() =>
    expect(mockAddFeedback).toHaveBeenCalledWith("v1", { body: "add a citation here", section_index: 1 }, "tok"));
});
