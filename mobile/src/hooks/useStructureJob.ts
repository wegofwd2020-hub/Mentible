import { useCallback, useEffect, useRef, useState } from "react";
import { getStructureJob } from "@/api/client";
import type {
  StructuredTOC,
  StructureJobResponse,
  StructureJobStatus,
} from "@/types/book";

const POLL_INTERVAL_MS = 3_000;

interface UseStructureJobResult {
  status: StructureJobStatus;
  toc: StructuredTOC | null;
  error: string | null;
  elapsed: number;
}

// Polls /jobs/{id} for a /structure job until done|failed. The interval is
// injectable so tests can avoid real timers.
export function useStructureJob(
  jobId: string | null,
  intervalMs = POLL_INTERVAL_MS,
): UseStructureJobResult {
  const [status, setStatus] = useState<StructureJobStatus>("queued");
  const [toc, setToc] = useState<StructuredTOC | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    // Reset per-job state so a resubmit (e.g. after a failed attempt) doesn't
    // briefly surface the previous job's status/error/result.
    setStatus("queued");
    setToc(null);
    setError(null);
    setElapsed(0);
    startTimeRef.current = Date.now();
    doneRef.current = false;

    const tick = async () => {
      if (doneRef.current) return;
      try {
        const job: StructureJobResponse = await getStructureJob(jobId);
        setStatus(job.status);
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));

        if (job.status === "done") {
          doneRef.current = true;
          setToc(job.result ?? null);
        } else if (job.status === "failed") {
          doneRef.current = true;
          setError(job.error ?? "Structuring failed");
        } else {
          timerRef.current = setTimeout(tick, intervalMs);
        }
      } catch {
        doneRef.current = true;
        setError("Lost connection to server");
      }
    };

    tick();
    return () => {
      doneRef.current = true;
      clearTimer();
    };
  }, [jobId, intervalMs, clearTimer]);

  return { status, toc, error, elapsed };
}
