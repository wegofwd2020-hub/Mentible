import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text, Pressable } from "react-native";
import { useTrustProject } from "@/hooks/useTrustProject";
jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn(), createArtifact: jest.fn(), createVersion: jest.fn(), invite: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: false }, loading: false }) }));
import * as tc from "@/api/trustClient";
function Probe() {
  const { addArtifact, invite } = useTrustProject("p1");
  return (<>
    <Pressable accessibilityLabel="art" onPress={() => addArtifact("cornerstone", "book")}><Text>a</Text></Pressable>
    <Pressable accessibilityLabel="inv" onPress={() => invite("e@x.z", "reviewer")}><Text>i</Text></Pressable>
  </>);
}
it("owner mutations call the client then refresh", async () => {
  (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  (tc.createArtifact as jest.Mock).mockResolvedValue({ id: "a" });
  (tc.invite as jest.Mock).mockResolvedValue({ project_id: "p1", invited_email: "e@x.z", role: "reviewer", revoked_at: null });
  render(<Probe />);
  await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText("art"));
  await waitFor(() => expect(tc.createArtifact).toHaveBeenCalledWith("p1", { role: "cornerstone", format: "book", title: undefined }, "tok"));
  fireEvent.press(screen.getByLabelText("inv"));
  await waitFor(() => expect(tc.invite).toHaveBeenCalledWith("p1", "e@x.z", "reviewer", "tok"));
  await waitFor(() => expect((tc.getProject as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3)); // refresh after each
});
