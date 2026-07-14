import { useCallback, useEffect, useState } from "react";
import { defaultPrefs, getPrefs, putPrefs } from "./shelfPrefsStore";
import type { ShelfPrefs } from "./filterEntries";

export function useShelfPrefs() {
  const [prefs, setState] = useState<ShelfPrefs>(defaultPrefs());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // getPrefs() is total (falls back to defaultPrefs() on any failure), but
      // guard here too so a future change to getPrefs can never re-strand the
      // hook in loading: true.
      let next = defaultPrefs();
      try {
        next = await getPrefs();
      } finally {
        if (!cancelled) {
          setState(next);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Note for callers (e.g. the Task 7 filter bar): do not derive the value
  // passed here from `prefs` while `loading` is true — the persisted load
  // hasn't landed yet and `prefs` is still defaultPrefs(), so doing so could
  // persist defaults-plus-one-field and clobber a stored value.
  const setPrefs = useCallback(async (p: ShelfPrefs) => {
    const previous = prefs;
    setState(p);
    try {
      await putPrefs(p);
    } catch {
      // Write failed: disk and memory would otherwise disagree (memory says
      // saved, disk still holds the old value, and the OLD value would
      // silently reappear on next launch). Revert in memory so the two never
      // diverge — a control that visibly snaps back is honest feedback that
      // the save failed. No error UI / retry / toast — out of scope here.
      setState(previous);
    }
  }, [prefs]);

  return { prefs, setPrefs, loading };
}
