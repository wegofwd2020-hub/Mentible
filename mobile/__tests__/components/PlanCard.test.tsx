import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PlanCard } from "@/components/PlanCard";
import type { PlanOffer } from "@/billing/types";

const OFFER: PlanOffer = {
  id: "managed_basic",
  kind: "managed",
  title: "Managed",
  price: "$9.99/mo",
  period: "month",
  blurb: "Includes $5 of generation each month. No API key needed.",
  renewalTerms: "$9.99/month, billed monthly until you cancel.",
  badge: "Easy",
};

describe("PlanCard", () => {
  it("renders title, price, blurb and badge", () => {
    render(<PlanCard offer={OFFER} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText("Managed")).toBeTruthy();
    expect(screen.getByText("$9.99/mo")).toBeTruthy();
    expect(screen.getByText(/No API key needed/)).toBeTruthy();
    expect(screen.getByText("Easy")).toBeTruthy();
  });

  it("omits the badge when the offer has none", () => {
    const noBadge: PlanOffer = { ...OFFER, badge: undefined };
    render(<PlanCard offer={noBadge} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByText("Easy")).toBeNull();
  });

  it("exposes selection to assistive tech as a radio", () => {
    render(<PlanCard offer={OFFER} selected onSelect={jest.fn()} />);
    const card = screen.getByRole("radio");
    expect(card.props.accessibilityState.selected).toBe(true);
  });

  it("does NOT render renewalTerms — those belong next to the CTA", () => {
    render(<PlanCard offer={OFFER} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByText(/billed monthly until you cancel/)).toBeNull();
  });

  it("calls onSelect with the offer id when tapped", () => {
    const onSelect = jest.fn();
    render(<PlanCard offer={OFFER} selected={false} onSelect={onSelect} />);
    fireEvent.press(screen.getByRole("radio"));
    expect(onSelect).toHaveBeenCalledWith("managed_basic");
  });
});
