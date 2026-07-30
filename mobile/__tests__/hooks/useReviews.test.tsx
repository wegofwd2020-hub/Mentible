import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { useReviews } from "@/hooks/useReviews";

jest.mock("@/api/trustClient", () => ({ syncSession: jest.fn(), getProject: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";

function Probe() {
  const { reviews, loading } = useReviews();
  if (loading) return <Text>loading</Text>;
  return <Text>{reviews.map((r) => `${r.title}:${r.versionsValidated}/${r.versionsTotal}`).join(",")}</Text>;
}

it("assembles review summaries from memberships + project detail", async () => {
  (tc.syncSession as jest.Mock).mockResolvedValue({
    account_id: "a", email: "e", memberships: [{ project_id: "p1", role: "reviewer" }],
  });
  (tc.getProject as jest.Mock).mockResolvedValue({
    project: { id: "p1", title: "Stormwater" },
    my_role: "reviewer",
    artifacts: [{ artifact: { id: "art" }, versions: [
      { id: "v1", version_no: 1, is_validated: true }, { id: "v2", version_no: 2, is_validated: false },
    ] }],
  });
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("Stormwater:1/2")).toBeTruthy());
});
