import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import NewProjectScreen from "@/../app/trust/new";
import { ApiError } from "@/api/client";

// New-project cap (T4): a Free user at the project cap gets a disabled Create
// with a "Free limit reached" hint; a 402 from the create call (belt-and-
// suspenders — the server is the real gate) shows an upgrade Alert. The
// client wall is UX only — plan:null (unknown) must fail OPEN, never disable.

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const mockCreate = jest.fn().mockResolvedValue({ id: "p1" });
jest.mock("@/hooks/useOwnedProjects", () => ({ useOwnedProjects: () => ({ create: (b: unknown) => mockCreate(b) }) }));

let mockPlan: { is_pro: boolean; at_project_cap: boolean } | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: mockPlan, loading: false }) }));

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = null;
  mockCreate.mockResolvedValue({ id: "p1" });
});

it("shows a subhead and a non-empty Title placeholder", () => {
  render(<NewProjectScreen />);
  expect(screen.getByText("Give your studio a topic to work on. You can refine any of this later.")).toBeTruthy();
  const titleInput = screen.getByLabelText("Title");
  expect(titleInput.props.placeholder).toBeTruthy();
});

it("unknown plan (fetch failed / signed out) — fails open, Create stays enabled", () => {
  mockPlan = null;
  render(<NewProjectScreen />);
  const btn = screen.getByLabelText("Create project");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
  expect(screen.queryByText("Free limit reached — upgrade to Pro")).toBeNull();
});

it("Pro plan — Create stays enabled even if at_project_cap is somehow set", () => {
  mockPlan = { is_pro: true, at_project_cap: true };
  render(<NewProjectScreen />);
  const btn = screen.getByLabelText("Create project");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
});

it("Free plan under cap — Create stays enabled", () => {
  mockPlan = { is_pro: false, at_project_cap: false };
  render(<NewProjectScreen />);
  const btn = screen.getByLabelText("Create project");
  expect(btn.props.accessibilityState?.disabled).toBeFalsy();
  expect(screen.queryByText("Free limit reached — upgrade to Pro")).toBeNull();
});

it("Free plan at the project cap — Create is disabled with a hint", () => {
  mockPlan = { is_pro: false, at_project_cap: true };
  render(<NewProjectScreen />);
  const btn = screen.getByLabelText("Create project");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText("Free limit reached — upgrade to Pro")).toBeTruthy();
});

it("a 402 on the create submit shows an upgrade prompt (belt-and-suspenders)", async () => {
  // plan unknown → the client wall doesn't block, so Create is still enabled;
  // the server (T2) is the one that 402s.
  mockPlan = null;
  mockCreate.mockRejectedValueOnce(new ApiError(402, JSON.stringify({ detail: "Free plan project limit reached" })));
  render(<NewProjectScreen />);
  fireEvent.changeText(screen.getByLabelText("Title"), "A new project");
  fireEvent.press(screen.getByLabelText("Create project"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Upgrade to Pro");
  expect(mockReplace).not.toHaveBeenCalled();
});
