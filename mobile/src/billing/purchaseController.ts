import { devPurchaseController } from "./devPurchaseController";
import type { PurchaseController } from "./types";

// THE SEAM. Today the only implementation is the dev stub. When RevenueCat is
// configured, add `revenueCatController.ts` and return it here — that is the
// entire integration surface on the client.
//
// Purchase success reaches the backend out-of-band via the RevenueCat webhook
// (backend/src/billing/revenuecat.py), never from this client. So a `purchased`
// result means "the store took money", never "the entitlement is live". The
// screen must re-read entitlement from GET /api/v1/billing/managed-status.

let override: PurchaseController | null = null;

export function getPurchaseController(): PurchaseController {
  return override ?? devPurchaseController;
}

/** Test-only. Pass `null` to restore the default. */
export function __setPurchaseController(c: PurchaseController | null): void {
  override = c;
}
