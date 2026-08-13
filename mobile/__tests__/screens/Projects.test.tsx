import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import ProjectsScreen from "@/../app/(tabs)/projects";

// Projects tab as the Lovable dashboard layout: kicker + Fraunces "Projects"
// header, a dashed-card empty state, a responsive project-card grid, and the
// New-project cap wall (Slice B) preserved.

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    R.useEffect(() => cb(), [cb]);
  },
}));
jest.mock("@/auth/RequireSignIn", () => ({
  RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/hooks/useOwnedProjects", () => ({ useOwnedProjects: jest.fn() }));
jest.mock("@/hooks/useResponsive", () => ({ useResponsive: jest.fn() }));

let mockPlan: { is_pro: boolean; at_project_cap: boolean } | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({
  useBillingPlan: () => ({ plan: mockPlan, loading: false }),
}));

import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { useResponsive } from "@/hooks/useResponsive";

function mockProjects(list: ReturnType<typeof buildProject>[]) {
  (useOwnedProjects as jest.Mock).mockReturnValue({
    projects: list,
    loading: false,
    error: null,
    refresh: jest.fn(),
    create: jest.fn(),
  });
}

function buildProject(overrides: Partial<{
  id: string; title: string; status: string; topic: string | null; audience: string | null; goal: string | null;
}> = {}) {
  return {
    id: "p1", title: "Alpha", status: "active", created_at: null,
    topic: null, audience: null, goal: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = null;
  (useResponsive as jest.Mock).mockReturnValue({ width: 390, isTablet: false, isDesktop: false });
});

it("renders the kicker + Fraunces 'Projects' header", () => {
  mockProjects([]);
  render(<ProjectsScreen />);
  expect(screen.getByText(/your studio/i)).toBeTruthy();
  expect(screen.getByText("Projects")).toBeTruthy();
});

it("shows the dashed empty state with a Create-project control that routes to /trust/new", () => {
  mockProjects([]);
  render(<ProjectsScreen />);
  expect(screen.getByText("Your first project awaits")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Create project"));
  expect(mockPush).toHaveBeenCalledWith("/trust/new");
});

it("renders a card per project (title, status, topic, audience·goal) and navigates on tap", () => {
  mockProjects([
    buildProject({ id: "p1", title: "Post-mortems", status: "in_review", topic: "Blameless culture", audience: "Eng leaders", goal: "Teach" }),
  ]);
  render(<ProjectsScreen />);
  expect(screen.getByText("Post-mortems")).toBeTruthy();
  expect(screen.getByText(/in review/i)).toBeTruthy();
  expect(screen.getByText("Blameless culture")).toBeTruthy();
  expect(screen.getByText(/Eng leaders/)).toBeTruthy();
  expect(screen.getByText(/Teach/)).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Open project: Post-mortems"));
  expect(mockPush).toHaveBeenCalledWith("/trust/p1");
});

it("New-project pill: disabled + 'Free limit reached' hint on Free plan at cap", () => {
  mockPlan = { is_pro: false, at_project_cap: true };
  mockProjects([buildProject()]);
  render(<ProjectsScreen />);
  const btn = screen.getByLabelText("New project");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText(/Free limit reached/i)).toBeTruthy();
});

it("New-project pill: enabled on Pro even if at_project_cap is set", () => {
  mockPlan = { is_pro: true, at_project_cap: true };
  mockProjects([buildProject()]);
  render(<ProjectsScreen />);
  const btn = screen.getByLabelText("New project");
  expect(btn.props.accessibilityState?.disabled).toBe(false);
  expect(screen.queryByText(/Free limit reached/i)).toBeNull();
});

it("New-project pill: fails open (enabled) when plan is null", () => {
  mockPlan = null;
  mockProjects([buildProject()]);
  render(<ProjectsScreen />);
  const btn = screen.getByLabelText("New project");
  expect(btn.props.accessibilityState?.disabled).toBe(false);
  expect(screen.queryByText(/Free limit reached/i)).toBeNull();
});
