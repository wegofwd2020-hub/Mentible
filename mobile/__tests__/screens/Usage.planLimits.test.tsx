import React from "react";
import { render, screen } from "@testing-library/react-native";
import UsageScreen from "@/../app/usage";
import type { PlanStatus } from "@/api/billingClient";

// The limits/upgrade surface (T4, Step 3) is embedded on the existing Usage
// screen, alongside the managed-token meter. This is an integration smoke
// test — component-level coverage (Free/Pro rendering, the mailto CTA,
// fail-open on plan:null) lives in __tests__/components/PlanLimitsCard.test.tsx.

jest.mock("expo-router", () => ({ useFocusEffect: (cb: () => void) => cb(), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok" }) }));
jest.mock("@/api/billingClient", () => ({
  getManagedStatus: jest.fn().mockResolvedValue({
    entitlement: null,
    usage: { cost_micros: 0, input_tokens: 0, output_tokens: 0, events: 0 },
    allowance_micros: null,
    window_start: "2026-06-01T00:00:00Z",
  }),
}));
jest.mock("@/storage/usageStore", () => ({
  listUsage: jest.fn().mockResolvedValue([]),
  clearUsage: jest.fn(),
  summarizeUsage: jest.fn(() => ({
    totalGenerations: 0, totalInputTokens: 0, totalOutputTokens: 0, estCostUsd: 0,
    anyRateUnknown: false, anyTokensEstimated: false, byModel: [],
  })),
}));

let mockPlan: PlanStatus | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: mockPlan, loading: false }) }));

beforeEach(() => { mockPlan = null; });

it("renders nothing from PlanLimitsCard when the plan is unknown", async () => {
  mockPlan = null;
  render(<UsageScreen />);
  expect(screen.queryByLabelText("Upgrade to Pro")).toBeNull();
});

it("renders the Free plan's caps/usage and Upgrade CTA", async () => {
  mockPlan = {
    is_pro: false,
    caps: { max_projects: 3, max_generations: 20, gen_window_days: 30 },
    usage: { projects: 2, generations: 10 },
    at_project_cap: false,
    at_generation_cap: false,
    features: [],
  };
  render(<UsageScreen />);
  expect(await screen.findByText("Free")).toBeTruthy();
  expect(screen.getByText("Projects: 2 / 3")).toBeTruthy();
  expect(screen.getByLabelText("Upgrade to Pro")).toBeTruthy();
});

it("renders 'Pro' for a Pro plan with no Upgrade CTA", async () => {
  mockPlan = {
    is_pro: true,
    caps: { max_projects: 3, max_generations: 20, gen_window_days: 30 },
    usage: { projects: 2, generations: 10 },
    at_project_cap: false,
    at_generation_cap: false,
    features: ["export_epub", "export_pdf", "export_docx"],
  };
  render(<UsageScreen />);
  expect(await screen.findByText("Pro")).toBeTruthy();
  expect(screen.queryByLabelText("Upgrade to Pro")).toBeNull();
});
