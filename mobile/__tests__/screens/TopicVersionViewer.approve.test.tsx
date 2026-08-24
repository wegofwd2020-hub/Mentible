// Approve flow on the per-topic viewer (the /trust/topic-version/[id] route — the
// screen the "Per Topic" tab actually opens). Same fix as trust/version/[versionId]:
// an owner's Approve opens a centered MODAL for the expert name instead of an inline
// block that rendered below the whole topic (off-screen, no cursor). A reviewer
// self-approves in one tap.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

let mockRole = "owner";
const mockApproveTopic = jest.fn(async (_id: string, opts?: { expertName: string }) => ({
  recorded_via: opts ? "operator" : "expert_self",
  expert_name: opts?.expertName ?? null,
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: mockApproveTopic,
    withdrawTopic: jest.fn(),
    generateTopic: jest.fn(),
    addTopicFeedback: jest.fn(),
  }),
}));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null, feedback: [],
  })),
}));
jest.mock("react-native-webview", () => ({
  default: ({ accessibilityLabel }: { accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>webview</Text>;
  },
}));

import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
});

it("owner: Approve opens the expert-name modal, then records with the name", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());

  expect(screen.queryByLabelText("Expert name")).toBeNull();
  fireEvent.press(screen.getByLabelText("Approve version 1"));

  expect(await screen.findByLabelText("Expert name")).toBeTruthy();
  expect(mockApproveTopic).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText("Expert name"), "Dr. Patel");
  fireEvent.press(screen.getByLabelText("Record approval"));

  await waitFor(() => expect(mockApproveTopic).toHaveBeenCalledWith("tv1", { expertName: "Dr. Patel" }));
});

it("reviewer: Approve records in one tap (no modal)", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Approve version 1"));

  await waitFor(() => expect(mockApproveTopic).toHaveBeenCalledWith("tv1"));
  expect(screen.queryByLabelText("Expert name")).toBeNull();
});
