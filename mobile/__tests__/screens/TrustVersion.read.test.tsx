import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "owner", inputs: [] }, addVersion: jest.fn(), generateVersion: jest.fn(), approve: jest.fn() }),
}));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "Enrollment windows", body: "Sign up during IEP.", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));
// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));

import { getVersion } from "@/api/trustClient";
import TrustVersion from "@/../app/trust/version/[versionId]";

it("renders the draft sections", async () => {
  const { getByText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("Enrollment windows")).toBeTruthy());
  expect(getByText("Sign up during IEP.")).toBeTruthy();
});

it("renders recorded_via provenance on a validated version", async () => {
  (getVersion as jest.Mock).mockResolvedValueOnce({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "Enrollment windows", body: "Sign up during IEP.", source_ids: [] }] },
    generation_meta: null, is_validated: true, recorded_via: "operator", created_at: null,
  });
  const { getByText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("operator-recorded")).toBeTruthy());
});

it("does not crash on a malformed version whose content has no sections", async () => {
  (getVersion as jest.Mock).mockResolvedValueOnce({
    id: "v1", artifact_id: "a1", version_no: 3,
    content: {}, generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  });
  const { getByText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("v3")).toBeTruthy());
});

it("does not crash on a section missing source_ids", async () => {
  (getVersion as jest.Mock).mockResolvedValueOnce({
    id: "v1", artifact_id: "a1", version_no: 4,
    content: { sections: [{ heading: "No sources", body: "Body text." }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  });
  const { getByText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("No sources")).toBeTruthy());
  expect(getByText("Body text.")).toBeTruthy();
});
