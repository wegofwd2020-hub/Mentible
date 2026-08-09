import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
const mockUseAuth = jest.fn((): { accessToken: string | null; status: string } => ({ accessToken: "tok", status: "signed_in" }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "reviewer" }, approveTopic: jest.fn(), withdrawTopic: jest.fn() }),
}));
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "operator",
  })),
}));

// Section bodies now render through TopicRenderer (visuals T2), which on
// native goes through a react-native-webview host. Stub it so its `source.html`
// prop (the built document) is inspectable — mirrors
// __tests__/app/chapter-quiz.test.tsx.
jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

import { getTopicVersion } from "@/api/trustClient";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

it("renders the topic title, section content (via the reader), and a validated indicator", async () => {
  const { getByText, getByLabelText } = render(<TopicVersionViewer />);
  await waitFor(() => expect(getByText("Reading music")).toBeTruthy());
  // The section heading + body are rendered by the reader pipeline into the
  // WebView document now, not as separate <Text> nodes.
  const doc = getByLabelText("Topic content").props.children as string;
  expect(doc).toContain("Staff");
  expect(doc).toContain("5 lines");
  expect(getByText(/Validated/i)).toBeTruthy();
  expect(getByText(/operator-recorded/i)).toBeTruthy();
});

it("does not crash when there is no auth token", () => {
  mockUseAuth.mockReturnValueOnce({ accessToken: null, status: "signed_out" });
  const callsBefore = (getTopicVersion as jest.Mock).mock.calls.length;
  expect(() => render(<TopicVersionViewer />)).not.toThrow();
  expect((getTopicVersion as jest.Mock).mock.calls.length).toBe(callsBefore);
});
