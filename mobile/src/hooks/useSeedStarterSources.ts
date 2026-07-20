import { useEffect } from "react";
import { seedStarterSources } from "@/openshelves/seedStarterSources";

// Seed the owner-curated starter shelves once per app start. Idempotent and
// deletion-safe (see seedStarterSources). Must never crash launch — swallow errors.
export function useSeedStarterSources(): void {
  useEffect(() => {
    void seedStarterSources().catch(() => {
      // A failed seed must not block app start; the user can still add sources.
    });
  }, []);
}
