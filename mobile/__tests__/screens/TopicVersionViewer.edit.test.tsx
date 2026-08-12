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
const mockEditTopic = jest.fn(async () => ({ id: "tv3", topic_id: "t1", version_no: 2 }));
let mockRole = "owner";
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole },
    approveTopic: mockApproveTopic,
    withdrawTopic: mockWithdrawTopic,
    generateTopic: mockGenerateTopic,
    editTopic: mockEditTopic,
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

// Section bodies render through TopicRenderer (visuals T2), which on native
// goes through a react-native-webview host — stub it so the module loads
// under jest (mirrors TopicVersionViewer.revise.test.tsx).
jest.mock("react-native-webview", () => ({
  default: ({ source, accessibilityLabel }: { source?: { html?: string }; accessibilityLabel?: string }) => {
    const { Text } = require("react-native");
    return <Text accessibilityLabel={accessibilityLabel}>{source?.html ?? ""}</Text>;
  },
}));

import { getTopicVersion } from "@/api/trustClient";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

beforeEach(() => { jest.clearAllMocks(); mockRole = "owner"; });

it("owner sees Edit text; entering edit mode seeds section editors from content; editing + Save as new version calls editTopic and navigates to the returned id", async () => {
  render(<TopicVersionViewer />);
  const editBtn = await screen.findByLabelText("Edit draft");
  expect(editBtn).toBeTruthy();

  fireEvent.press(editBtn);
  const headingInput = await screen.findByLabelText("Section 1 heading");
  expect(headingInput.props.value).toBe("Staff");
  const bodyInput = screen.getByLabelText("Section 1 body");
  expect(bodyInput.props.value).toBe("5 lines");

  fireEvent.changeText(bodyInput, "5 lines, treble clef");

  fireEvent.press(screen.getByLabelText("Save as new version"));
  await waitFor(() =>
    expect(mockEditTopic).toHaveBeenCalledWith("t1", {
      sections: [{ heading: "Staff", body: "5 lines, treble clef", source_ids: [] }],
    }),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/trust/topic-version/tv3?projectId=p1"));
});

it("reviewer sees no Edit text control", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());
  expect(screen.queryByLabelText("Edit draft")).toBeNull();
});

it("a validated version confirms before entering edit mode", async () => {
  (getTopicVersion as jest.Mock).mockResolvedValue({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "expert_self",
  });
  render(<TopicVersionViewer />);
  const editBtn = await screen.findByLabelText("Edit draft");
  fireEvent.press(editBtn);
  // The mocked Alert auto-presses the non-cancel ("Edit") button.
  await screen.findByLabelText("Section 1 heading");
});
