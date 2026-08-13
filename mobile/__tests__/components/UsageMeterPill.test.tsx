import React from "react";
import { render, screen } from "@testing-library/react-native";
import { UsageMeterPill } from "@/components/UsageMeterPill";
import type { ManagedStatus } from "@/api/billingClient";

function makeStatus(overrides: Partial<ManagedStatus> = {}): ManagedStatus {
  return {
    entitlement: {
      plan_id: "pro",
      plan_display: "Pro",
      status: "active",
      period_start: "2026-08-01",
      period_end: "2026-09-01",
    },
    usage: { cost_micros: 1_000_000, input_tokens: 100, output_tokens: 50, events: 3 },
    allowance_micros: 5_000_000,
    window_start: "2026-08-01",
    ...overrides,
  };
}

describe("UsageMeterPill", () => {
  it("renders the plan display + used/cap text + a bar for an entitled status", () => {
    render(<UsageMeterPill status={makeStatus()} />);
    expect(screen.getByText(/Pro/)).toBeTruthy();
    expect(screen.getByText(/\$1\.00/)).toBeTruthy();
    expect(screen.getByText(/\$5\.00/)).toBeTruthy();
    expect(screen.getByTestId("usage-meter-bar")).toBeTruthy();
  });

  it("renders nothing when entitlement is null", () => {
    const { toJSON } = render(<UsageMeterPill status={makeStatus({ entitlement: null })} />);
    expect(toJSON()).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders no bar and shows 'unlimited' when allowance_micros is 0", () => {
    render(<UsageMeterPill status={makeStatus({ allowance_micros: 0 })} />);
    expect(screen.getByText(/unlimited/i)).toBeTruthy();
    expect(screen.queryByTestId("usage-meter-bar")).toBeNull();
  });

  it("exposes a warn level at >= 80% usage via testID/accessibilityState, not color", () => {
    render(
      <UsageMeterPill
        status={makeStatus({
          usage: { cost_micros: 4_000_000, input_tokens: 1, output_tokens: 1, events: 1 },
          allowance_micros: 5_000_000,
        })}
      />,
    );
    const pill = screen.getByRole("button");
    expect(pill.props.testID).toBe("usage-meter-pill-warn");
  });

  it("exposes an over level at >= 100% usage via testID/accessibilityState, not color", () => {
    render(
      <UsageMeterPill
        status={makeStatus({
          usage: { cost_micros: 6_000_000, input_tokens: 1, output_tokens: 1, events: 1 },
          allowance_micros: 5_000_000,
        })}
      />,
    );
    const pill = screen.getByRole("button");
    expect(pill.props.testID).toBe("usage-meter-pill-over");
  });

  it("has accessibilityRole=button and a matching accessibilityLabel", () => {
    render(<UsageMeterPill status={makeStatus()} />);
    const pill = screen.getByRole("button");
    expect(pill.props.accessibilityLabel).toMatch(/Pro/);
    expect(pill.props.accessibilityLabel).toMatch(/\$1\.00/);
    expect(pill.props.accessibilityLabel).toMatch(/\$5\.00/);
  });
});
