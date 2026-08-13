// Fetches the signed-in user's Free/Pro plan status for the client-side export
// Pro-wall (T3). This is UX only — the server (T2) is the real gate on export
// submission (402 for authenticated Free users) — so this hook must FAIL OPEN:
// signed-out, loading, or a rejected fetch all resolve to plan:null, and every
// caller treats null as "unknown — don't wall" (never throws).

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { getPlanStatus, type PlanStatus } from "@/api/billingClient";

export function useBillingPlan(): { plan: PlanStatus | null; loading: boolean } {
  const { accessToken } = useAuth();
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!accessToken) {
        setPlan(null);
        return;
      }
      let active = true;
      setLoading(true);
      getPlanStatus(accessToken)
        .then((p) => {
          if (active) setPlan(p);
        })
        .catch(() => {
          if (active) setPlan(null); // fail open — never wall on a fetch error
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [accessToken]),
  );

  return { plan, loading };
}
