import { useCallback, useEffect, useState } from "react";
import { defaultPrefs, getPrefs, putPrefs } from "./shelfPrefsStore";
import type { ShelfPrefs } from "./filterEntries";

export function useShelfPrefs() {
  const [prefs, setState] = useState<ShelfPrefs>(defaultPrefs());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setState(await getPrefs());
      setLoading(false);
    })();
  }, []);

  const setPrefs = useCallback(async (p: ShelfPrefs) => {
    setState(p);
    await putPrefs(p);
  }, []);

  return { prefs, setPrefs, loading };
}
