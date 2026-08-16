import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));

// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../helpers/mockTopicRenderer"));

const mockApprove = jest.fn(async () => ({ recorded_via: "expert_self", expert_name: "Dr X" }));
const mockUnapprove = jest.fn(async () => ({ recorded_via: "expert_self", action: "withdraw" }));
let mockRole = "reviewer";
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: mockRole, inputs: [] }, addVersion: jest.fn(), generateVersion: jest.fn(), approve: mockApprove, unapprove: mockUnapprove }),
}));

const mockCopyText = jest.fn(async (_t: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (t: string) => mockCopyText(t) }));

// Auto-press the non-cancel button of any Alert confirm; ignore buttonless alerts.
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m?: string, btns?: { style?: string; onPress?: () => void }[]) => btns?.find((b) => b.style !== "cancel")?.onPress?.() } }));

jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "Enrollment", body: "Sign up during IEP.", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));

import { getVersion } from "@/api/trustClient";
import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => { jest.clearAllMocks(); mockRole = "reviewer"; });

it("Copy puts the draft's headings and bodies on the clipboard", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("Enrollment")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Copy draft"));
  await waitFor(() => expect(mockCopyText).toHaveBeenCalledWith("Enrollment\n\nSign up during IEP."));
});

it("Approve records validation for an awaiting version", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Approve version 2")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Approve version 2"));
  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("v1"));
});

it("an owner records approval on a named expert's behalf", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  // Owner taps Approve → a name field appears (no direct approve yet).
  fireEvent.press(await screen.findByLabelText("Approve version 2"));
  expect(mockApprove).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Expert name"), "Dr X");
  fireEvent.press(screen.getByLabelText("Record approval"));
  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("v1", { expertName: "Dr X" }));
});

it("a validated version offers Unapprove, which withdraws the approval", async () => {
  (getVersion as jest.Mock).mockResolvedValue({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "Enrollment", body: "Body.", source_ids: [] }] },
    generation_meta: null, is_validated: true, recorded_via: "expert_self", created_at: null,
  });
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Withdraw approval of version 2")).toBeTruthy());
  expect(screen.queryByLabelText("Approve version 2")).toBeNull();
  fireEvent.press(screen.getByLabelText("Withdraw approval of version 2"));
  await waitFor(() => expect(mockUnapprove).toHaveBeenCalledWith("v1"));
});
