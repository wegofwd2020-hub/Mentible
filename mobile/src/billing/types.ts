// The purchase contract. TYPES ONLY — no runtime value lives here, so the factory
// (which imports the stub as a value) and the stub (which imports these as types)
// cannot form an import cycle.

export type PlanKind = "managed" | "byok";

export interface PlanOffer {
  /**
   * For kind "managed" this MUST equal a backend plans.py plan id ("managed_basic") —
   * that string is the only join key between "what you paid" (RevenueCat) and "what you
   * get" (the plan's allowance). For kind "byok" it is a store product id only: BYOK
   * grants no entitlement and has no plans.py row.
   */
  id: string;
  kind: PlanKind;
  title: string;
  /** Store-formatted and localized (RevenueCat's `product.priceString`). Never parse this. */
  price: string;
  period: "month" | "year";
  blurb: string;
  /** Rendered verbatim above the CTA. Store policy requires price + period + renewal there. */
  renewalTerms: string;
  badge?: string;
}

/**
 * `cancelled` is a first-class variant, not a thrown error: RevenueCat reports a user
 * backing out via `userCancelled` on an *error* object, and the commonest paywall bug is
 * rendering "Purchase failed" when someone simply tapped back. Modelling it here means the
 * screen physically cannot show an error for it. `unavailable` is a variant for the same
 * reason — the dev stub returns it, so the "not wired up yet" path is exercised by the code
 * that will later handle "Play Store unreachable".
 */
export type PurchaseResult =
  | { kind: "purchased"; planId: string }
  | { kind: "cancelled" }
  | { kind: "unavailable"; reason: string };

export interface PurchaseController {
  offerings(): Promise<PlanOffer[]>;
  purchase(planId: string): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult>;
}
