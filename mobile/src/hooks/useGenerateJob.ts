import { useCallback, useEffect, useRef, useState } from "react";
import { getJobStatus } from "@/api/client";
import type { JobResponse, JobStatus, LessonOutput } from "@/types/lesson";

const POLL_INTERVAL_MS = 3_000;

interface UseGenerateJobResult {
  status: JobStatus;
  lesson: LessonOutput | null;
  error: string | null;
  elapsed: number;
}

export function useGenerateJob(jobId: string | null): UseGenerateJobResult {
  const [status, setStatus] = useState<JobStatus>("queued");
  const [lesson, setLesson] = useState<LessonOutput | null>(null);
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

    startTimeRef.current = Date.now();
    doneRef.current = false;

    const tick = async () => {
      if (doneRef.current) return;
      try {
        const job: JobResponse = await getJobStatus(jobId);
        setStatus(job.status);
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));

        if (job.status === "done") {
          doneRef.current = true;
          setLesson(job.result ?? null);
        } else if (job.status === "failed") {
          doneRef.current = true;
          setError(job.error ?? "Generation failed");
        } else {
          timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
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
  }, [jobId, clearTimer]);

  return { status, lesson, error, elapsed };
}
