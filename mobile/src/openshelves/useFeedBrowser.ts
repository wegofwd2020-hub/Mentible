// mobile/src/openshelves/useFeedBrowser.ts
// An OPDS browse stack. The catalog is a tree of feeds; a navigation entry points
// to a sub-feed we fetch on demand (reusing the hardened fetchFeed/parseOpds12
// path — so web goes through the CORS proxy too). Sub-feed entries are transient:
// they live only in this stack, never in the per-source store (spec N2).
//
// The root frame is a LIVE read from `root` (props), not seeded into useState.
// useState's initializer only runs once on mount — if we seeded `[root]`, a root
// that arrives asynchronously (exactly what happens once this hook is wired into
// the catalog screen: useSourceCatalog loads entries async, so this hook first
// mounts with an EMPTY root) would be captured stale forever and the root frame
// would never show its entries once they load. So `pushed` holds only the
// sub-feed frames the user has drilled into; the root frame itself is always
// derived fresh from the current `root` prop.
import { useCallback, useMemo, useState } from "react";
import { fetchFeed } from "./fetchFeed";
import { parseOpds12 } from "./opds12";
import { resolveUrl } from "./downloadTarget";
import { toMessage } from "./errorMessage";
import type { FeedEntry } from "./types";

export interface BrowseFrame {
  title: string;
  url: string;
  entries: FeedEntry[];
}

export function useFeedBrowser(root: BrowseFrame) {
  const [pushed, setPushed] = useState<BrowseFrame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frame = pushed.length > 0 ? pushed[pushed.length - 1] : root;
  const canGoBack = pushed.length > 0;
  const crumbs = useMemo(() => [root.title, ...pushed.map((f) => f.title)], [root.title, pushed]);

  const enter = useCallback(async (entry: FeedEntry) => {
    if (!entry.navigationUrl) return;
    const url = resolveUrl(frame.url, entry.navigationUrl);
    if (!url) { setError("That catalog link isn't valid."); return; }
    setLoading(true);
    setError(null);
    try {
      const xml = await fetchFeed(url);
      const { entries } = parseOpds12(xml);
      setPushed((s) => [...s, { title: entry.title, url, entries }]);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [frame.url]);

  const back = useCallback(() => {
    setError(null);
    setPushed((s) => (s.length > 0 ? s.slice(0, -1) : s));
  }, []);

  return { frame, crumbs, canGoBack, loading, error, enter, back };
}
