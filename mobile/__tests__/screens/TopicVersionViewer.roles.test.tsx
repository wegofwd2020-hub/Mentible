import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

// P0-2 slice C follow-up: mirror the whole-book viewer's role split onto the
// per-topic draft viewer. editor edits but cannot approve; reviewer approves
// but cannot edit; owner does both. Revise (generate_topic_version) stayed
// owner-only on the backend, so an editor must not see it (tapping would 403).

let mockRole = "owner";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: jest.fn(),
    withdrawTopic: jest.fn(),
    generateTopic: jest.fn(),
    editTopic: jest.fn(),
    listTopicVersions: jest.fn(async () => []),
    addTopicFeedback: jest.fn(),
  }),
}));

// Section bodies render through TopicRenderer, whose native branch pulls in
// react-native-webview. Mock the renderer so headings render as plain text —
// waiting on the heading is the deterministic "load settled" signal that keeps
// each test's async getTopicVersion from bleeding into the next.
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));

jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
  })),
}));

import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => { mockRole = "owner"; });

it("editor sees Edit text but not Approve or Revise", async () => {
  mockRole = "editor";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Staff")).toBeTruthy());
  expect(screen.getByLabelText("Edit draft")).toBeTruthy();
  expect(screen.queryByLabelText("Approve version 1")).toBeNull();
  expect(screen.queryByLabelText("Revise draft")).toBeNull();
});

it("reviewer sees Approve but not Edit or Revise", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Staff")).toBeTruthy());
  expect(screen.getByLabelText("Approve version 1")).toBeTruthy();
  expect(screen.queryByLabelText("Edit draft")).toBeNull();
  expect(screen.queryByLabelText("Revise draft")).toBeNull();
});

it("owner sees Edit, Approve and Revise", async () => {
  mockRole = "owner";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("Staff")).toBeTruthy());
  expect(screen.getByLabelText("Edit draft")).toBeTruthy();
  expect(screen.getByLabelText("Approve version 1")).toBeTruthy();
  expect(screen.getByLabelText("Revise draft")).toBeTruthy();
});
