import type { PlanOffer, PurchaseController, PurchaseResult } from "./types";

// ─── DO NOT SHIP ────────────────────────────────────────────────────────────
// Placeholder prices. The real ones come from RevenueCat offerings, which are
// store-formatted and localized per storefront. These exist only so the Plans
// screen can be built, reviewed and tested before billing is configured.
// A store build MUST swap this controller out. If it doesn't, purchase() is
// inert (resolves `unavailable`) rather than wrong — it never charges and never
// throws.
// ────────────────────────────────────────────────────────────────────────────

// "Unlimited" is deliberately absent from the managed offer: plans.py's uncapped
// tier is an open-ended token liability. BYOK says "from us" because the limit
// that remains is the user's own provider account.
const DEV_OFFERS: PlanOffer[] = [
  {
    id: "managed_basic", // = plans.py plan id
    kind: "managed",
    title: "Managed",
    price: "$9.99/mo",
    period: "month",
    blurb: "Includes $5 of generation each month. No API key needed.",
    renewalTerms: "$9.99/month, billed monthly until you cancel. Renews automatically.",
    badge: "Easy",
  },
  {
    id: "byok",
    kind: "byok",
    title: "Bring your own key",
    price: "$19.99/yr",
    period: "year",
    blurb: "You pay Anthropic directly. No generation limit from us.",
    renewalTerms: "$19.99/year, billed annually until you cancel. Renews automatically.",
  },
];

const NOT_CONFIGURED = "Plans aren’t available in this build yet.";

// Params are omitted rather than ignored — a stub that accepts fewer arguments still
// satisfies the interface, and TS keeps the call sites honest.
export const devPurchaseController: PurchaseController = {
  async offerings(): Promise<PlanOffer[]> {
    return DEV_OFFERS;
  },
  async purchase(): Promise<PurchaseResult> {
    return { kind: "unavailable", reason: NOT_CONFIGURED };
  },
  async restore(): Promise<PurchaseResult> {
    return { kind: "unavailable", reason: NOT_CONFIGURED };
  },
};
