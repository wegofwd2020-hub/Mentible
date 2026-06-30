import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { EntitlementStatus, ManagedStatus } from "@/api/billingClient";
import { ManagedPlanCard } from "@/components/ManagedPlanCard";

function makeStatus(over: Partial<ManagedStatus> = {}): ManagedStatus {
  return {
    entitlement: null,
    usage: { cost_micros: 0, input_tokens: 0, output_tokens: 0, events: 0 },
    allowance_micros: null,
    window_start: "2026-06-01T00:00:00Z",
    ...over,
  };
}

function ent(status: EntitlementStatus = "active") {
  return {
    plan_id: "managed_basic",
    plan_display: "Managed Basic",
    status,
    period_start: "2026-06-01T00:00:00Z",
    period_end: "2026-07-01T00:00:00Z",
  };
}

describe("ManagedPlanCard", () => {
  it("shows a BYOK message when there is no entitlement", () => {
    render(<ManagedPlanCard status={makeStatus()} />);
    expect(screen.getByText(/bring-your-own-key/i)).toBeTruthy();
  });

  it("shows the plan, status, and a usage meter under the cap", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({
          entitlement: ent("active"),
          allowance_micros: 5_000_000,
          usage: { cost_micros: 1_000_000, input_tokens: 1, output_tokens: 1, events: 2 },
        })}
      />,
    );
    expect(screen.getByText("Managed Basic")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("$1.00 of $5.00 used")).toBeTruthy();
    // Not over cap → no allowance-exhausted warning.
    expect(screen.queryByText(/used your allowance/i)).toBeNull();
  });

  it("warns when the allowance is used up", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({
          entitlement: ent("active"),
          allowance_micros: 5_000_000,
          usage: { cost_micros: 5_000_000, input_tokens: 1, output_tokens: 1, events: 9 },
        })}
      />,
    );
    expect(screen.getByText(/used your allowance/i)).toBeTruthy();
  });

  it("shows an unlimited meter when the allowance is 0", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({
          entitlement: ent("active"),
          allowance_micros: 0,
          usage: { cost_micros: 2_000_000, input_tokens: 1, output_tokens: 1, events: 1 },
        })}
      />,
    );
    expect(screen.getByText(/unlimited this period/i)).toBeTruthy();
  });

  it("surfaces a past-due payment issue", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({ entitlement: ent("past_due"), allowance_micros: 5_000_000 })}
      />,
    );
    expect(screen.getByText("Payment issue")).toBeTruthy();
    expect(screen.getByText(/payment issue with your subscription/i)).toBeTruthy();
  });

  it("explains a canceled plan falls back to BYOK", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({ entitlement: ent("canceled"), allowance_micros: 5_000_000 })}
      />,
    );
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getByText(/falls back to your own key/i)).toBeTruthy();
  });
});
