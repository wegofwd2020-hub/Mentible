// Approve flow — SME model: the owner IS the validating expert, so owner AND
// reviewer both approve in ONE TAP as themselves (expert_self). No name modal,
// no confirmation dialog.
let mockRole = "owner";
const mockApprove = jest.fn(async (_id: string) => ({
  recorded_via: "expert_self",
  expert_name: "owner@x.z",
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

it("owner: Approve records in one tap as themselves — no name modal", async () => {
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Approve version 2"));

  // one tap → approve called with NO opts (expert_self, own identity); no modal
  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("v1"));
  expect(screen.queryByLabelText("Expert name")).toBeNull();
});

it("reviewer: Approve records in one tap (no modal)", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Approve version 2"));

  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("v1"));
  expect(screen.queryByLabelText("Expert name")).toBeNull();
});
