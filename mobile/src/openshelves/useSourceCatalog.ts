// mobile/src/openshelves/useSourceCatalog.ts
// Loads one source's record + its catalog entries for the browse screen, with a
// per-source refresh. Read-only over the plan-2 stores; components stay dumb.
import { useCallback, useEffect, useState } from "react";
import type { FeedEntry, FeedSource } from "./types";
import { FeedSourceError } from "./errors";
import { getSource } from "./feedSourcesStore";
import { getEntries } from "./feedEntriesStore";
import { refreshSource } from "./feedStore";

function toMessage(err: unknown): string {
  if (err instanceof FeedSourceError && err.authRequired) {
    return "Authenticated repos aren't supported yet.";
  }
  return (err as Error)?.message ?? "Something went wrong.";
}

export function useSourceCatalog(sourceId: string) {
  const [source, setSource] = useState<FeedSource | null>(null);
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, e] = await Promise.all([getSource(sourceId), getEntries(sourceId)]);
    setSource(s);
    setEntries(e);
    setLoading(false);
  }, [sourceId]);

  useEffect(() => { void reload(); }, [reload]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { await refreshSource(sourceId); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [sourceId, reload]);

  return { source, entries, loading, busy, error, reload, refresh };
}
