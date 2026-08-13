// Fetches the signed-in user's managed-plan billing status for the in-shell
// usage meter (compact quota indicator in app chrome). Non-critical chrome:
// a failed fetch never throws, it just leaves the meter hidden (status:null).

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { getManagedStatus, type ManagedStatus } from "@/api/billingClient";

export function useManagedStatus(): { status: ManagedStatus | null; loading: boolean } {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<ManagedStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!accessToken) {
        setStatus(null);
        return;
      }
      let active = true;
      setLoading(true);
      getManagedStatus(accessToken)
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch(() => {
          if (active) setStatus(null); // meter is non-critical chrome
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [accessToken]),
  );

  return { status, loading };
}
