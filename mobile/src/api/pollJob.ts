import { ApiError, resolveBaseUrl } from "@/api/client";

// The shared async-job status row shape returned by GET /api/v1/jobs/{id}.
// Generic over the job-specific `result` payload (topic content, TOC
// suggestion, a draft version, ...).
export interface JobStatusView<R> {
  status: "queued" | "running" | "done" | "failed";
  result?: R;
  error?: string;
}

export interface PollJobOpts {
  intervalMs: number;
  timeoutMs?: number; // default 600_000
  timeoutMessage: string;
  failedMessage: string;
  onPhase?: (p: "queued" | "running") => void;
}

const DEFAULT_TIMEOUT_MS = 600_000;

async function fetchJob<R>(jobId: string, token: string): Promise<JobStatusView<R>> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<JobStatusView<R>>;
}

// Submit-agnostic poll of the shared GET /api/v1/jobs/{id} status row. Resolves
// the job's `result` on done; throws Error(job.error ?? failedMessage) on
// failed or on a done with no result; rejects Error(timeoutMessage) past the
// deadline; rethrows a fetch/ApiError. `onPhase` fires only for queued/running.
export function pollJob<R>(jobId: string, token: string, opts: PollJobOpts): Promise<R> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return new Promise<R>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error(opts.timeoutMessage));
        return;
      }
      try {
        const job = await fetchJob<R>(jobId, token);
        if (job.status === "queued" || job.status === "running") {
          opts.onPhase?.(job.status);
          setTimeout(tick, opts.intervalMs);
          return;
        }
        if (job.status === "done" && job.result !== undefined) {
          resolve(job.result);
          return;
        }
        reject(new Error(job.error ?? opts.failedMessage));
      } catch (err) {
        reject(err as Error);
      }
    };
    void tick();
  });
}
