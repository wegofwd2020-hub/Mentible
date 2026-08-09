import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));

const mockApproveTopic = jest.fn(async () => ({ recorded_via: "expert_self", expert_name: "Dr X" }));
const mockWithdrawTopic = jest.fn(async () => ({ recorded_via: "expert_self", action: "withdraw" }));
let mockRole = "reviewer";
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: mockApproveTopic,
    withdrawTopic: mockWithdrawTopic,
  }),
}));

// Auto-press the non-cancel button of any Alert confirm; ignore buttonless alerts.
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m?: string, btns?: { style?: string; onPress?: () => void }[]) => btns?.find((b) => b.style !== "cancel")?.onPress?.() } }));

jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
  })),
}));

// Section bodies now render through TopicRenderer (visuals T2), which on
// native goes through a react-native-webview host — stub it so the module
// loads under jest (mirrors __tests__/app/chapter-quiz.test.tsx). This test
// file only exercises approve/withdraw, not the rendered content.
jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

import { getTopicVersion } from "@/api/trustClient";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => { jest.clearAllMocks(); mockRole = "reviewer"; });

it("reviewer approves in one tap, no name field", async () => {
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Approve version 1"));
  await waitFor(() => expect(mockApproveTopic).toHaveBeenCalledWith("tv1"));
});

it("owner records approval on a named expert's behalf", async () => {
  mockRole = "owner";
  render(<TopicVersionViewer />);
  fireEvent.press(await screen.findByLabelText("Approve version 1"));
  expect(mockApproveTopic).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Expert name"), "Dr X");
  fireEvent.press(screen.getByLabelText("Record approval"));
  await waitFor(() => expect(mockApproveTopic).toHaveBeenCalledWith("tv1", { expertName: "Dr X" }));
});

it("a validated version shows the badge and Withdraw, which withdraws the approval", async () => {
  (getTopicVersion as jest.Mock).mockResolvedValue({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "expert_self",
  });
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText(/validated/i)).toBeTruthy());
  expect(screen.queryByLabelText("Approve version 1")).toBeNull();
  fireEvent.press(screen.getByLabelText("Withdraw approval of version 1"));
  await waitFor(() => expect(mockWithdrawTopic).toHaveBeenCalledWith("tv1"));
});
