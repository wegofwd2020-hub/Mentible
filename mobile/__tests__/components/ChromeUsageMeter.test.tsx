import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// The engine chip refreshes on focus — run the callback immediately so the async
// reload (engine label + device tokens) executes during the test.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => cb(),
}));

let mockStatus: unknown = null;
jest.mock("@/hooks/useManagedStatus", () => ({
  useManagedStatus: () => ({ status: mockStatus, loading: false }),
}));

// Free-tier counter source. null = signed out / unknown (no counter shown).
let mockPlan: unknown = null;
jest.mock("@/hooks/useBillingPlan", () => ({
  useBillingPlan: () => ({ plan: mockPlan, loading: false }),
}));

const mockLoadDefaultParams = jest.fn();
jest.mock("@/storage/settingsStore", () => ({
  loadDefaultParams: () => mockLoadDefaultParams(),
}));

const mockSummary = jest.fn();
jest.mock("@/storage/usageStore", () => ({
  listUsage: jest.fn().mockResolvedValue([]),
  summarizeUsage: () => mockSummary(),
}));

import { ChromeUsageMeter } from "@/components/ChromeUsageMeter";

const ENTITLED = {
  entitlement: { plan_id: "pro", plan_display: "Pro", status: "active", period_start: "x", period_end: "y" },
  usage: { cost_micros: 1_000_000, input_tokens: 100, output_tokens: 50, events: 3 },
  allowance_micros: 5_000_000,
  window_start: "x",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = null;
  mockPlan = null;
  mockLoadDefaultParams.mockResolvedValue({ provider: "anthropic" });
  mockSummary.mockReturnValue({ totalInputTokens: 1200, totalOutputTokens: 300 });
});

it("shows the active engine label (short) for everyone", async () => {
  render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText(/Claude/)).toBeTruthy());
});

it("shows this device's token count for a BYOK/anonymous user", async () => {
  render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText("1.5k tok")).toBeTruthy());
});

it("shows the managed $ allowance pill (not device tokens) for an entitled user", async () => {
  mockStatus = ENTITLED;
  render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText(/Pro ·/)).toBeTruthy());
  expect(screen.queryByText(/tok$/)).toBeNull(); // device-token line is replaced by the pill
});

it("tapping opens the Usage screen", async () => {
  render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText(/Claude/)).toBeTruthy());
  fireEvent.press(screen.getByLabelText(/open usage/));
  expect(mockPush).toHaveBeenCalledWith("/usage");
});

const FREE_PLAN = {
  is_pro: false,
  caps: { max_projects: 2, max_generations: 20, gen_window_days: 30 },
  usage: { projects: 1, generations: 3 },
  at_project_cap: false,
  at_generation_cap: false,
  features: [],
};

it("shows the Free generation counter for a signed-in Free user", async () => {
  mockPlan = FREE_PLAN;
  render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText("3/20 free")).toBeTruthy());
});

it("hides the Free generation counter for Pro and signed-out users", async () => {
  mockPlan = { ...FREE_PLAN, is_pro: true };
  const { unmount } = render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText(/Claude/)).toBeTruthy());
  expect(screen.queryByText(/free$/)).toBeNull();
  unmount();
  mockPlan = null;
  render(<ChromeUsageMeter />);
  await waitFor(() => expect(screen.getByText(/Claude/)).toBeTruthy());
  expect(screen.queryByText(/free$/)).toBeNull();
});
