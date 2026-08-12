import { useEffect, useRef, useState } from "react";

// Milliseconds since `startedAt`, updated ~1s. Returns 0 when startedAt is null.
// One instance per visible progress indicator; clears its interval on
// null/unmount so a finished generation stops ticking.
export function useElapsedMs(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (startedAt === null) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    setNow(Date.now());
    timer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [startedAt]);

  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
