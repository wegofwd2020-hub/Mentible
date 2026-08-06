import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "vA", b: "vB", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: () => ({ project: { inputs: [] } }) }));
const mockGetVersion = jest.fn(async (id: string) =>
  id === "vA"
    ? { id: "vA", artifact_id: "a1", version_no: 1, content: { sections: [{ heading: "H", body: "old body", source_ids: [] }] }, generation_meta: null, is_validated: false, recorded_via: null, created_at: null }
    : { id: "vB", artifact_id: "a1", version_no: 2, content: { sections: [{ heading: "H", body: "new body", source_ids: [] }, { heading: "Extra", body: "added", source_ids: [] }] }, generation_meta: null, is_validated: true, recorded_via: "operator", created_at: null },
);
jest.mock("@/api/trustClient", () => ({ getVersion: (id: string) => mockGetVersion(id) }));

import TrustCompare from "@/../app/trust/compare/[versionId]";

it("renders both versions and marks changed + added sections", async () => {
  const { getByText, getByTestId } = render(<TrustCompare />);
  await waitFor(() => expect(getByText("old body")).toBeTruthy());
  expect(getByText("new body")).toBeTruthy();
  expect(getByTestId("section-0-changed")).toBeTruthy();  // H body differs
  expect(getByTestId("section-1-added")).toBeTruthy();     // Extra only in B
});
