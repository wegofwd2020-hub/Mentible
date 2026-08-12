import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { suggestToc as suggestTocApi, getSuggestTocJob, type StructuredTocView, type SuggestTocJobStatusView } from "@/api/trustClient";

export type SuggestTocJobUiStatus = "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;
// Same rationale as useGenerateTopicJob.ts's POLL_TIMEOUT_MS — a whole-book
// outline suggestion can legitimately take minutes, especially with a
// schema-repair retry loop server-side.
const POLL_TIMEOUT_MS = 600_000;

export interface RunSuggestTocArgs {
  projectId: string;
  apiKey: string;
  accessToken: string;
  providerId?: string;
  // Called on each poll tick with the job's current status, for callers
  // driving a foreground progress bar (Waiting -> Generating). Only invoked
  // for "queued"/"running" — not for the terminal "done"/"failed" states.
  onPhase?: (p: "queued" | "running") => void;
}

export interface UseSuggestTocJobResult {
  status: SuggestTocJobUiStatus;
  error: string | null;
  // Submit the suggest-toc job then poll /jobs/{id} until done|failed.
  // Resolves with the suggested toc on success; throws on failure or timeout
  // (mirrors the pre-async suggestToc()'s throwing-promise contract so
  // existing call sites need no shape changes).
  run: (args: RunSuggestTocArgs) => Promise<StructuredTocView>;
}

// Polls the shared GET /api/v1/jobs/{id} (see trustClient.getSuggestTocJob)
// until the job reaches done|failed, or bails past POLL_TIMEOUT_MS.
// Injectable interval so tests avoid real timers.
function pollSuggestJob(
  jobId: string,
  accessToken: string,
  intervalMs: number,
  onPhase?: (p: "queued" | "running") => void,
): Promise<SuggestTocJobStatusView> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  return new Promise<SuggestTocJobStatusView>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for the outline"));
        return;
      }
      try {
        const job = await getSuggestTocJob(jobId, accessToken);
        if (job.status === "queued" || job.status === "running") onPhase?.(job.status);
        if (job.status === "done" || job.status === "failed") {
          resolve(job);
        } else {
          setTimeout(tick, intervalMs);
        }
      } catch (err) {
        reject(err);
      }
    };
    void tick();
  });
}

// Submit-then-poll for the Phase B async suggest-TOC job. Exposed as an
// imperative `run()` (like useGenerateTopicJob.ts) since callers already own
// their own busy/error UI state around a single awaited promise.
export function useSuggestTocJob(intervalMs = POLL_INTERVAL_MS): UseSuggestTocJobResult {
  const [status, setStatus] = useState<SuggestTocJobUiStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: RunSuggestTocArgs): Promise<StructuredTocView> => {
      setError(null);
      setStatus("generating");
      try {
        const submitted = await suggestTocApi(
          args.projectId,
          { api_key: args.apiKey, provider_id: args.providerId ?? "anthropic" },
          args.accessToken,
        );
        const job = await pollSuggestJob(submitted.job_id, args.accessToken, intervalMs, args.onPhase);
        if (job.status === "done" && job.result) {
          setStatus("done");
          return job.result.toc;
        }
        throw new Error(job.error ?? "Couldn't suggest an outline");
      } catch (err) {
        const message =
          err instanceof ApiError ? err.userMessage() : err instanceof Error ? err.message : "Couldn't suggest an outline";
        setStatus("failed");
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [intervalMs],
  );

  return { status, error, run };
}
