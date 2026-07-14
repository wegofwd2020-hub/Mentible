import { useCallback, useEffect, useRef, useState } from "react";
import { defaultPrefs, getPrefs, putPrefs } from "./shelfPrefsStore";
import type { ShelfPrefs } from "./filterEntries";

export function useShelfPrefs() {
  const [prefs, setState] = useState<ShelfPrefs>(defaultPrefs());
  const [loading, setLoading] = useState(true);

  // Last-committed-to-disk value ("last known good"). `prefs` state can be a
  // transient optimistic value while a write is in flight; this ref is only
  // ever updated at the same three points state is authoritatively settled
  // (initial load, a successful write, and — implicitly — a revert, since a
  // revert sets state back to this same ref value). Reading it lazily inside
  // setPrefs's catch (rather than snapshotting it into a local up front)
  // is what makes two overlapping calls revert to the right value: see the
  // trace in the review finding this fixes.
  const committedRef = useRef<ShelfPrefs>(prefs);

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
          committedRef.current = next;
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
  //
  // No deps: this closure never reads component-scoped state directly (only
  // the ref, and the stable setState/putPrefs references), so its identity
  // is stable across renders.
  const setPrefs = useCallback(async (p: ShelfPrefs) => {
    setState(p);
    try {
      await putPrefs(p);
      committedRef.current = p;
    } catch {
      // Write failed: disk and memory would otherwise disagree (memory says
      // saved, disk still holds the old value, and the OLD value would
      // silently reappear on next launch). Revert in memory to the last
      // value we know is actually on disk — read fresh from the ref here,
      // not a value captured before the `await` above, so a second call
      // that fails after a first call already succeeded reverts to that
      // first call's value, not a stale snapshot from before either call
      // ran. A control that visibly snaps back is honest feedback that the
      // save failed. No error UI / retry / toast — out of scope here.
      setState(committedRef.current);
    }
  }, []);

  return { prefs, setPrefs, loading };
}
