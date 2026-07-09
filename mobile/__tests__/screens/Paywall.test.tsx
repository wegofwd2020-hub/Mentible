import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/help", () => ({ HelpButton: () => null }));

import { __setPurchaseController } from "@/billing/purchaseController";
import type { PlanOffer, PurchaseController, PurchaseResult } from "@/billing/types";
import PaywallScreen from "../../app/paywall";

const MANAGED: PlanOffer = {
  id: "managed_basic",
  kind: "managed",
  title: "Managed",
  price: "$9.99/mo",
  period: "month",
  blurb: "Includes $5 of generation each month. No API key needed.",
  renewalTerms: "$9.99/month, billed monthly until you cancel. Renews automatically.",
  badge: "Easy",
};
const BYOK: PlanOffer = {
  id: "byok",
  kind: "byok",
  title: "Bring your own key",
  price: "$19.99/yr",
  period: "year",
  blurb: "You pay Anthropic directly. No generation limit from us.",
  renewalTerms: "$19.99/year, billed annually until you cancel. Renews automatically.",
};

function controller(over: Partial<PurchaseController> = {}): PurchaseController {
  return {
    offerings: jest.fn().mockResolvedValue([MANAGED, BYOK]),
    purchase: jest.fn().mockResolvedValue({ kind: "cancelled" } as PurchaseResult),
    restore: jest.fn().mockResolvedValue({ kind: "cancelled" } as PurchaseResult),
    ...over,
  };
}

async function renderReady(c: PurchaseController = controller()) {
  __setPurchaseController(c);
  render(<PaywallScreen />);
  await waitFor(() => expect(screen.getByText("Managed")).toBeTruthy());
  return c;
}

afterEach(() => __setPurchaseController(null));

describe("Paywall screen", () => {
  it("preselects Managed, not the other plan", async () => {
    await renderReady();
    const [managed, byok] = screen.getAllByRole("radio");
    expect(managed.props.accessibilityState.selected).toBe(true);
    expect(byok.props.accessibilityState.selected).toBe(false);
  });

  it("shows exactly four benefit bullets", async () => {
    await renderReady();
    expect(screen.getAllByLabelText("benefit")).toHaveLength(4);
  });

  // The regression test for the teardown's central defect: a CTA promising one plan's
  // terms while another plan is selected.
  it("swaps BOTH the CTA label and the renewal terms when the plan changes", async () => {
    await renderReady();
    expect(screen.getByText("Start with Managed")).toBeTruthy();
    expect(screen.getByText(MANAGED.renewalTerms)).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Bring your own key, $19.99/yr"));

    expect(screen.getByText("Start with your own key")).toBeTruthy();
    expect(screen.getByText(BYOK.renewalTerms)).toBeTruthy();
    expect(screen.queryByText(MANAGED.renewalTerms)).toBeNull();
    expect(screen.queryByText("Start with Managed")).toBeNull();
  });

  it("purchases the SELECTED plan, not the default", async () => {
    const c = await renderReady();
    fireEvent.press(screen.getByLabelText("Bring your own key, $19.99/yr"));
    fireEvent.press(screen.getByText("Start with your own key"));
    await waitFor(() => expect(c.purchase).toHaveBeenCalledWith("byok"));
  });

  it("renders NO error when the user cancels the purchase", async () => {
    const c = await renderReady(
      controller({ purchase: jest.fn().mockResolvedValue({ kind: "cancelled" }) }),
    );
    fireEvent.press(screen.getByText("Start with Managed"));
    await waitFor(() => expect(c.purchase).toHaveBeenCalled());
    expect(screen.queryByLabelText("notice")).toBeNull();
    expect(screen.queryByLabelText("error")).toBeNull();
  });

  it("renders a notice (not an error) when purchase is unavailable", async () => {
    await renderReady(
      controller({
        purchase: jest.fn().mockResolvedValue({ kind: "unavailable", reason: "Not yet." }),
      }),
    );
    fireEvent.press(screen.getByText("Start with Managed"));
    await waitFor(() => expect(screen.getByLabelText("notice")).toBeTruthy());
    expect(screen.getByText("Not yet.")).toBeTruthy();
    expect(screen.queryByLabelText("error")).toBeNull();
  });

  it("Restore calls restore() and reports its outcome as a notice", async () => {
    const c = await renderReady(
      controller({
        restore: jest.fn().mockResolvedValue({ kind: "unavailable", reason: "Nothing to restore." }),
      }),
    );
    fireEvent.press(screen.getByText("Restore"));
    await waitFor(() => expect(c.restore).toHaveBeenCalled());
    expect(screen.getByText("Nothing to restore.")).toBeTruthy();
  });

  // Store policy: price + period + renewal, adjacent to the purchase button — for
  // WHICHEVER plan is selected. Asserts against the rendered screen, never the fixtures.
  it.each([
    ["Managed, $9.99/mo", MANAGED],
    ["Bring your own key, $19.99/yr", BYOK],
  ])("renders %s's renewal terms beside the CTA", async (label, offer) => {
    await renderReady();
    fireEvent.press(screen.getByLabelText(label));
    expect(screen.getByLabelText("renewal terms")).toHaveTextContent(offer.renewalTerms);
  });

  it("shows an error with Retry when offers fail to load, and Retry reloads", async () => {
    const offerings = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([MANAGED, BYOK]);
    __setPurchaseController(controller({ offerings }));
    render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByLabelText("error")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText("Retry"));
    });
    await waitFor(() => expect(screen.getByText("Managed")).toBeTruthy());
  });

  // Alert.alert is a no-op on RN-web, and this screen ships to /app/mentible. Guard the
  // real defect — importing or calling it — not the spelling. Comment prose may say "Alert".
  it("renders the preview banner in the ready state", async () => {
    await renderReady();
    expect(screen.getByLabelText("preview banner")).toBeTruthy();
  });

  it("preview banner text names the preview state", async () => {
    await renderReady();
    expect(screen.getByLabelText("preview banner")).toHaveTextContent(
      "Preview — paid plans aren't purchasable yet. Bring-your-own-key works today.",
    );
  });

  it("never imports Alert from react-native, and never calls Alert.alert", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../app/paywall.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/Alert\.alert/);
    expect(src).not.toMatch(/import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*"react-native"/);
  });
});
