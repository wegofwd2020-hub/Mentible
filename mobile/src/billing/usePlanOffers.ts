import { useCallback, useEffect, useState } from "react";
import { getPurchaseController } from "./purchaseController";
import type { PlanOffer } from "./types";

export type OffersState =
  | { kind: "loading" }
  | { kind: "ready"; offers: PlanOffer[] }
  | { kind: "error"; message: string };

// Loads the plan offers once on mount. `reload` re-runs it (the screen's Retry).
// The returned shape is stable — `{ state, reload }` regardless of variant — so the
// screen never conditionally destructures.
export function usePlanOffers(): { state: OffersState; reload: () => void } {
  const [state, setState] = useState<OffersState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const offers = await getPurchaseController().offerings();
      setState({ kind: "ready", offers });
    } catch {
      // The reason is never surfaced verbatim: an offerings failure is a store/network
      // problem the user can only retry, and provider errors can carry noise.
      setState({ kind: "error", message: "Couldn’t load plans. Check your connection." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: () => void load() };
}
