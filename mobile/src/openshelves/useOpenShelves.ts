// mobile/src/openshelves/useOpenShelves.ts
// React binding over the plan-2 feedStore: owns the sources list + loading/busy/
// error state for the Sources screen. The only openshelves module that touches
// the store; components stay presentational.
import { useCallback, useEffect, useState } from "react";
import type { FeedSource } from "./types";
import { FeedSourceError } from "./errors";
import { listSources } from "./feedSourcesStore";
import { addSource, removeSource, refreshSource, refreshAll } from "./feedStore";

function toMessage(err: unknown): string {
  if (err instanceof FeedSourceError && err.authRequired) {
    return "Authenticated repos aren't supported yet.";
  }
  return (err as Error)?.message ?? "Something went wrong.";
}

export function useOpenShelves() {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSources(await listSources());
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const add = useCallback(async (url: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await addSource(url);
      await reload();
      return true;
    } catch (err) {
      setError(toMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try { await removeSource(id); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [reload]);

  const refresh = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try { await refreshSource(id); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [reload]);

  const refreshAllSources = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { await refreshAll(); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [reload]);

  return { sources, loading, busy, error, reload, add, remove, refresh, refreshAllSources };
}
