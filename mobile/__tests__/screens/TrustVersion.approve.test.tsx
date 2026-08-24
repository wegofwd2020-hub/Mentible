// Approve flow (tablet bug 2026-08-23): an OWNER's "Approve" reveals an expert-name
// field (operator-recorded provenance) that used to render below the fold with no
// feedback → "Approve does nothing". It now opens as a centered MODAL. A REVIEWER
// still self-approves in one tap.
let mockRole = "owner";
const mockApprove = jest.fn(async (_id: string, opts?: { expertName: string }) => ({
  recorded_via: opts ? "operator" : "expert_self",
  expert_name: opts?.expertName ?? null,
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({
    project: { my_role: mockRole, inputs: [] },
    addVersion: jest.fn(),
    generateVersion: jest.fn(),
    approve: mockApprove,
    unapprove: jest.fn(),
  }),
}));
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../../test-utils/mockTopicRenderer"));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "owner";
});

it("owner: Approve opens the expert-name modal (not a silent no-op), then records with the name", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  // Modal not shown, nothing approved yet.
  expect(screen.queryByLabelText("Expert name")).toBeNull();

  fireEvent.press(screen.getByLabelText("Approve version 2"));

  // The name field is now visible (the modal opened) — no approval sent yet.
  expect(await screen.findByLabelText("Expert name")).toBeTruthy();
  expect(mockApprove).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText("Expert name"), "Dr. R. Patel");
  fireEvent.press(screen.getByLabelText("Record approval"));

  await waitFor(() =>
    expect(mockApprove).toHaveBeenCalledWith("v1", { expertName: "Dr. R. Patel" }),
  );
});

it("reviewer: Approve records in one tap (no modal)", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Approve version 2"));

  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("v1"));
  expect(screen.queryByLabelText("Expert name")).toBeNull();
});
