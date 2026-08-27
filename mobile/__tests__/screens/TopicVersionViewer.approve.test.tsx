// Approve flow on the per-topic viewer (/trust/topic-version/[id]). SME model:
// the owner IS the validating expert, so owner AND reviewer both approve in ONE
// TAP as themselves (expert_self) — no name modal, no confirmation dialog.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

let mockRole = "owner";
const mockApproveTopic = jest.fn(async (_id: string) => ({
  recorded_via: "expert_self",
  expert_name: "owner@x.z",
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

it("owner: Approve records in one tap as themselves — no name modal", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Approve version 1"));

  // one tap → approveTopic called with NO opts (expert_self, own identity)
  await waitFor(() => expect(mockApproveTopic).toHaveBeenCalledWith("tv1"));
  // no expert-name modal is ever shown
  expect(screen.queryByLabelText("Expert name")).toBeNull();
});

it("reviewer: Approve records in one tap (no modal)", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Approve version 1"));

  await waitFor(() => expect(mockApproveTopic).toHaveBeenCalledWith("tv1"));
  expect(screen.queryByLabelText("Expert name")).toBeNull();
});
