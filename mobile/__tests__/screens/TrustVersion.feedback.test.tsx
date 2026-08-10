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
// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));

const mockAddFeedback = jest.fn(async (_id: string, _body: { body: string }, _token: string) => ({ id: "f2", version_id: "v1", author_kind: "expert", author_name: "Dr X", body: "add a source", created_at: null }));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "Enrollment", body: "Body.", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [{ id: "f1", version_id: "v1", author_kind: "expert", author_name: "Dr X", body: "tighten the intro", created_at: null }],
  })),
  addFeedback: (id: string, body: { body: string }, token: string) => mockAddFeedback(id, body, token),
}));

import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => jest.clearAllMocks());

it("lists existing revision notes for the version", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("tighten the intro")).toBeTruthy());
  expect(screen.getByText(/Dr X/)).toBeTruthy();
});

it("Request a revision posts a note and clears the field", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Revision note")).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText("Revision note"), "add a source");
  fireEvent.press(screen.getByLabelText("Send revision request"));
  await waitFor(() => expect(mockAddFeedback).toHaveBeenCalledWith("v1", { body: "add a source" }, "tok"));
});
