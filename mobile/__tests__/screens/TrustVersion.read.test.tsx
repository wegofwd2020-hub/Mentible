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
