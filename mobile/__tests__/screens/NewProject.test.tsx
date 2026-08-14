import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import NewProjectScreen from "@/../app/trust/new";
import { ApiError } from "@/api/client";

// New-project screen, restyled to the Lovable layout (layout only — same
// fields/behavior): a "Back to projects" link, a multiline Topic field, a
// 2-col Audience/Goal row on tablet width, a pill Create button, centered
// content. The Free/Pro project cap (T4) behavior below is unchanged.

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
}));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const mockCreate = jest.fn().mockResolvedValue({ id: "p1" });
jest.mock("@/hooks/useOwnedProjects", () => ({ useOwnedProjects: () => ({ create: (b: unknown) => mockCreate(b) }) }));

let mockPlan: { is_pro: boolean; at_project_cap: boolean } | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: mockPlan, loading: false }) }));

jest.mock("@/hooks/useResponsive", () => ({ useResponsive: jest.fn() }));
import { useResponsive } from "@/hooks/useResponsive";

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = null;
  mockCanGoBack = true;
  mockCreate.mockResolvedValue({ id: "p1" });
  (useResponsive as jest.Mock).mockReturnValue({ width: 390, isTablet: false, isDesktop: false });
});

it("shows a subhead and a non-empty Title placeholder", () => {
  render(<NewProjectScreen />);
  expect(screen.getByText("Give your studio a topic to work on. You can refine any of this later.")).toBeTruthy();
  const titleInput = screen.getByLabelText("Title");
  expect(titleInput.props.placeholder).toBeTruthy();
});

it("renders a back link that calls router.back when a screen is on the stack", () => {
  mockCanGoBack = true;
  render(<NewProjectScreen />);
  fireEvent.press(screen.getByLabelText("Back to projects"));
  expect(mockBack).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it("back link falls back to replacing /projects when there's nothing to go back to", () => {
  mockCanGoBack = false;
  render(<NewProjectScreen />);
  fireEvent.press(screen.getByLabelText("Back to projects"));
  expect(mockReplace).toHaveBeenCalledWith("/projects");
  expect(mockBack).not.toHaveBeenCalled();
});

it("the Topic field is multiline", () => {
  render(<NewProjectScreen />);
  expect(screen.getByLabelText("Topic").props.multiline).toBe(true);
});

it("Title/Topic/Audience/Goal all accept text", () => {
  render(<NewProjectScreen />);
  fireEvent.changeText(screen.getByLabelText("Title"), "A title");
  fireEvent.changeText(screen.getByLabelText("Topic"), "A topic");
  fireEvent.changeText(screen.getByLabelText("Audience"), "An audience");
  fireEvent.changeText(screen.getByLabelText("Goal"), "A goal");
  expect(screen.getByLabelText("Title").props.value).toBe("A title");
  expect(screen.getByLabelText("Topic").props.value).toBe("A topic");
  expect(screen.getByLabelText("Audience").props.value).toBe("An audience");
  expect(screen.getByLabelText("Goal").props.value).toBe("A goal");
});

it("Create project with a title calls create with the trimmed payload, then navigates", async () => {
  render(<NewProjectScreen />);
  fireEvent.changeText(screen.getByLabelText("Title"), "  A title  ");
  fireEvent.changeText(screen.getByLabelText("Topic"), "  A topic  ");
  fireEvent.changeText(screen.getByLabelText("Audience"), "  ");
  fireEvent.changeText(screen.getByLabelText("Goal"), "");
  fireEvent.press(screen.getByLabelText("Create project"));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
    title: "A title",
    topic: "A topic",
    audience: undefined,
    goal: undefined,
  }));
  expect(mockReplace).toHaveBeenCalledWith("/trust/p1");
});

it("an empty title shows the Title-required alert and does not call create", () => {
  render(<NewProjectScreen />);
  fireEvent.press(screen.getByLabelText("Create project"));
  expect(mockAlert).toHaveBeenCalledWith("Title required", "Give the project a title.");
  expect(mockCreate).not.toHaveBeenCalled();
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

it("stacks Audience/Goal on phone width (isTablet:false)", () => {
  (useResponsive as jest.Mock).mockReturnValue({ width: 390, isTablet: false, isDesktop: false });
  render(<NewProjectScreen />);
  const row = screen.getByTestId("audienceGoalRow");
  const flat = [row.props.style].flat(Infinity).filter(Boolean);
  expect(flat.some((s: Record<string, unknown>) => s.flexDirection === "row")).toBe(false);
});

it("puts Audience/Goal side-by-side on tablet width (isTablet:true)", () => {
  (useResponsive as jest.Mock).mockReturnValue({ width: 900, isTablet: true, isDesktop: false });
  render(<NewProjectScreen />);
  const row = screen.getByTestId("audienceGoalRow");
  const flat = [row.props.style].flat(Infinity).filter(Boolean);
  expect(flat.some((s: Record<string, unknown>) => s.flexDirection === "row")).toBe(true);
});
