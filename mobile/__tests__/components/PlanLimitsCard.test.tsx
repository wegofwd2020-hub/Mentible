import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { PlanStatus } from "@/api/billingClient";
import { PlanLimitsCard } from "@/components/PlanLimitsCard";

// The limits/upgrade surface (T4, Step 3) — shows plan (Free/Pro), caps +
// current usage, and an "Upgrade to Pro" CTA. There is NO payment rail yet,
// so the CTA opens a contact-mail explainer, never a checkout. Guards for
// plan:null (still loading, signed out, or a failed billing fetch) by
// rendering nothing (hide).

function makePlan(over: Partial<PlanStatus> = {}): PlanStatus {
  return {
    is_pro: false,
    caps: { max_projects: 3, max_generations: 20, gen_window_days: 30 },
    usage: { projects: 1, generations: 5 },
    at_project_cap: false,
    at_generation_cap: false,
    features: [],
    ...over,
  };
}

describe("PlanLimitsCard", () => {
  it("renders nothing when plan is null and not loading", () => {
    const { toJSON } = render(<PlanLimitsCard plan={null} loading={false} />);
    expect(toJSON()).toBeNull();
  });

  it("shows a loading state when plan is null and loading", () => {
    render(<PlanLimitsCard plan={null} loading={true} />);
    expect(screen.getByText(/loading plan/i)).toBeTruthy();
  });

  it("Free plan — shows the Free badge, caps/usage, and an Upgrade to Pro CTA", () => {
    render(<PlanLimitsCard plan={makePlan({ is_pro: false })} loading={false} />);
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("Projects: 1 / 3")).toBeTruthy();
    expect(screen.getByText("Generations: 5 / 20 (last 30d)")).toBeTruthy();
    expect(screen.getByLabelText("Upgrade to Pro")).toBeTruthy();
    // No checkout — the CTA explains the operator-grant path.
    expect(screen.getByText(/no self-serve checkout/i)).toBeTruthy();
  });

  it("Pro plan — shows the Pro badge, caps/usage, and no Upgrade CTA", () => {
    render(<PlanLimitsCard plan={makePlan({ is_pro: true })} loading={false} />);
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText("Projects: 1 / 3")).toBeTruthy();
    expect(screen.queryByLabelText("Upgrade to Pro")).toBeNull();
  });

  it("the Upgrade to Pro CTA opens a mailto link, not a checkout", () => {
    const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    render(<PlanLimitsCard plan={makePlan({ is_pro: false })} loading={false} />);
    fireEvent.press(screen.getByLabelText("Upgrade to Pro"));
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/));
    spy.mockRestore();
  });
});
