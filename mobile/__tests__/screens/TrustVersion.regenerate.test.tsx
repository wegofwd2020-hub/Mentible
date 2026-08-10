const mockGenerateVersion = jest.fn(async () => ({ id: "v3", artifact_id: "a1", version_no: 3, created_at: null }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "owner", inputs: [] }, addVersion: jest.fn(), generateVersion: mockGenerateVersion, approve: jest.fn() }),
}));
// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));

import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import TrustVersion from "@/../app/trust/version/[versionId]";

it("regenerates with guidance", async () => {
  const { getByText, getByLabelText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("H")).toBeTruthy());
  fireEvent.press(getByLabelText("Regenerate draft"));
  fireEvent.changeText(getByLabelText("Regeneration guidance"), "focus on 2026 costs");
  fireEvent.press(getByLabelText("Generate new version"));
  await waitFor(() => expect(mockGenerateVersion).toHaveBeenCalledWith("a1", { guidance: "focus on 2026 costs" }));
});
