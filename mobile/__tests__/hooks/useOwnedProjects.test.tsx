import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
jest.mock("@/api/trustClient", () => ({ listOwnedProjects: jest.fn(), createProject: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";
function Probe() { const { projects, loading } = useOwnedProjects(); return <Text>{loading ? "…" : projects.map((p) => p.title).join(",")}</Text>; }
it("lists owned projects", async () => {
  (tc.listOwnedProjects as jest.Mock).mockResolvedValue([{ id: "p1", title: "Alpha", status: "active", created_at: null }]);
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
});
