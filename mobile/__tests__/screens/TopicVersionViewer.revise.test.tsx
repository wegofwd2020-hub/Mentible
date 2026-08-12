import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));

const mockApproveTopic = jest.fn(async () => ({ recorded_via: "expert_self", expert_name: "Dr X" }));
const mockWithdrawTopic = jest.fn(async () => ({ recorded_via: "expert_self", action: "withdraw" }));
const mockGenerateTopic = jest.fn(async () => ({ id: "tv2", topic_id: "t1", version_no: 2 }));
let mockRole = "owner";
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: mockApproveTopic,
    withdrawTopic: mockWithdrawTopic,
    generateTopic: mockGenerateTopic,
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
// loads under jest (mirrors TopicVersionViewer.approve.test.tsx).
jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

import { getTopicVersion } from "@/api/trustClient";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => { jest.clearAllMocks(); mockRole = "owner"; });

it("owner sees Revise; pressing it on an unvalidated version reveals the guidance box; generating navigates to the new version", async () => {
  render(<TopicVersionViewer />);
  const reviseBtn = await screen.findByLabelText("Revise draft");
  expect(reviseBtn).toBeTruthy();

  fireEvent.press(reviseBtn);
  const guidanceInput = await screen.findByLabelText("Revision guidance");
  fireEvent.changeText(guidanceInput, "Add more detail on ledger lines");

  fireEvent.press(screen.getByLabelText("Generate new version"));
  await waitFor(() =>
    expect(mockGenerateTopic).toHaveBeenCalledWith("t1", { guidance: "Add more detail on ledger lines" }),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/trust/topic-version/tv2?projectId=p1"));
});

it("reviewer sees no Revise control; Approve is still present", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());
  expect(screen.queryByLabelText("Revise draft")).toBeNull();
});

it("a validated version confirms before revealing the guidance box", async () => {
  (getTopicVersion as jest.Mock).mockResolvedValue({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "expert_self",
  });
  render(<TopicVersionViewer />);
  const reviseBtn = await screen.findByLabelText("Revise draft");
  fireEvent.press(reviseBtn);
  // The mocked Alert auto-presses the non-cancel ("Revise") button.
  await screen.findByLabelText("Revision guidance");
});
