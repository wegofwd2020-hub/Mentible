import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text, Pressable } from "react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";

function Probe() {
  const { project, approve } = useTrustProject("p1");
  return (
    <>
      <Text>{project ? project.project.title : "…"}</Text>
      <Pressable accessibilityLabel="approve" onPress={() => approve("v2")}><Text>go</Text></Pressable>
    </>
  );
}

it("loads the project and approve() calls the client then refreshes", async () => {
  (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "reviewer", artifacts: [] });
  (tc.approveVersion as jest.Mock).mockResolvedValue({ id: "ap", version_id: "v2", recorded_via: "expert_self", expert_name: "e", approved_at: "t" });
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("P")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("approve"));
  await waitFor(() => expect(tc.approveVersion).toHaveBeenCalledWith("v2", expect.objectContaining({ approved_at: expect.any(String) }), "tok"));
  await waitFor(() => expect((tc.getProject as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)); // refresh
});
