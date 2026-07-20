// mobile/src/openshelves/useSourceCatalog.ts
// Loads one source's record + its catalog entries for the browse screen, with a
// per-source refresh. Read-only over the plan-2 stores; components stay dumb.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedEntry, FeedSource } from "./types";
import { getSource } from "./feedSourcesStore";
import { getEntries } from "./feedEntriesStore";
import { refreshSource } from "./feedStore";
import { toMessage } from "./errorMessage";

export function useSourceCatalog(sourceId: string) {
  const [source, setSource] = useState<FeedSource | null>(null);
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([getSource(sourceId), getEntries(sourceId)]);
      setSource(s);
      setEntries(e);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => { void reload(); }, [reload]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { await refreshSource(sourceId); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [sourceId, reload]);

  // Lazy hydration: a seeded (starter) source is added with no entries and
  // lastRefreshedAt === null. The first time it's opened, fetch it once —
  // guarded by a ref (not state) so a failed hydration is terminal for this
  // sourceId and does not retry-loop; the user must tap Refresh explicitly.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !source) return;
    if (source.lastRefreshedAt !== null || entries.length > 0) return;
    if (hydratedFor.current === sourceId) return; // one attempt per source; terminal on failure
    hydratedFor.current = sourceId;
    void refresh();
  }, [loading, source, entries.length, sourceId, refresh]);

  return { source, entries, loading, busy, error, reload, refresh };
}
