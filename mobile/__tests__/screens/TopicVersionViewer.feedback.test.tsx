import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Per-topic feedback thread + reviewer note box + owner revise-from-note
// (S3 — mirrors trust/version/[versionId].tsx's feedback block, see
// TrustVersion.feedback.test.tsx / TrustVersion.revise-from-note.test.tsx).

let mockRole = "reviewer";
const mockGenerateTopic = jest.fn(async () => ({ id: "tv2", topic_id: "t1", version_no: 2 }));
const mockAddTopicFeedback = jest.fn(async (_id: string, _body: { body: string }) => ({
  id: "f2", author_kind: "expert", author_name: "Dr X", body: "add a source", created_at: null,
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: jest.fn(),
    withdrawTopic: jest.fn(),
    generateTopic: mockGenerateTopic,
    addTopicFeedback: mockAddTopicFeedback,
  }),
}));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));

jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
    feedback: [{ id: "f1", author_kind: "expert", author_name: "Dr X", body: "tighten the intro", created_at: null }],
  })),
}));

jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "reviewer";
});

it("renders the feedback thread from topicVersion.feedback", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("tighten the intro")).toBeTruthy());
  expect(screen.getByText(/Dr X/)).toBeTruthy();
});

it("reviewer sees the revision-note box (not 'Revise from this note'); posting calls addTopicFeedback", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Revision note")).toBeTruthy());
  expect(screen.queryByLabelText("Revise from this note")).toBeNull();

  fireEvent.changeText(screen.getByLabelText("Revision note"), "add a source");
  fireEvent.press(screen.getByLabelText("Send revision request"));
  await waitFor(() => expect(mockAddTopicFeedback).toHaveBeenCalledWith("tv1", { body: "add a source" }));
});

it("owner sees 'Revise from this note' (not the note box); pressing it prefills guidance and opens revise", async () => {
  mockRole = "owner";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("tighten the intro")).toBeTruthy());
  expect(screen.queryByLabelText("Revision note")).toBeNull();

  fireEvent.press(screen.getByLabelText("Revise from this note"));
  const guidanceInput = await waitFor(() => screen.getByLabelText("Revision guidance"));
  expect(guidanceInput.props.value).toContain("tighten the intro");
});
