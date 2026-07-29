import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import ProjectsScreen from "@/../app/(tabs)/projects";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (cb: () => void) => { const R = require("react"); R.useEffect(() => cb(), [cb]); } }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/hooks/useOwnedProjects", () => ({ useOwnedProjects: jest.fn() }));
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
beforeEach(() => jest.clearAllMocks());
it("lists owned projects, navigates, and New Project routes to the form", async () => {
  (useOwnedProjects as jest.Mock).mockReturnValue({ projects: [{ id: "p1", title: "Alpha", status: "active", created_at: null }], loading: false, error: null, refresh: jest.fn(), create: jest.fn() });
  render(<ProjectsScreen />);
  fireEvent.press(await screen.findByLabelText("Open project: Alpha"));
  expect(mockPush).toHaveBeenCalledWith("/trust/p1");
  fireEvent.press(screen.getByLabelText("New project"));
  expect(mockPush).toHaveBeenCalledWith("/trust/new");
});
it("shows empty state", () => {
  (useOwnedProjects as jest.Mock).mockReturnValue({ projects: [], loading: false, error: null, refresh: jest.fn(), create: jest.fn() });
  render(<ProjectsScreen />);
  expect(screen.getByText(/no projects yet/i)).toBeTruthy();
});
