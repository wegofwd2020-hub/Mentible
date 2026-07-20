// Proactive one-and-done nudge visibility (F3). Hidden until the dismissed set
// loads (D4 fail-closed); dismiss persists so it never reappears.
import { useCallback, useEffect, useState } from "react";
import { dismissNudge, loadDismissed } from "./nudgeStore";

export function useNudge(key: string): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    loadDismissed()
      .then((dismissed) => { if (active && !dismissed.includes(key)) setVisible(true); })
      .catch(() => { /* fail closed: stay hidden */ });
    return () => { active = false; };
  }, [key]);
  const dismiss = useCallback(() => {
    setVisible(false);
    void dismissNudge(key).catch(() => { /* swallow: worst case it reappears next launch */ });
  }, [key]);
  return { visible, dismiss };
}
