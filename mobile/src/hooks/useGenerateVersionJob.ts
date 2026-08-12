import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { generateVersion as generateVersionApi, getGenerateVersionJob, type GenerateVersionJobStatusView } from "@/api/trustClient";

export type GenerateVersionJobUiStatus = "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;
// Same rationale as useGenerateTopicJob.ts's POLL_TIMEOUT_MS — a whole-book
// (or whole-artifact) draft can legitimately take minutes, and a
// schema-repair retry loop can push that further.
const POLL_TIMEOUT_MS = 600_000;

export interface RunGenerateVersionArgs {
  artifactId: string;
  apiKey: string;
  accessToken: string;
  providerId?: string;
  guidance?: string;
  // Called on each poll tick with the job's current status, for callers
  // driving a foreground progress bar (Waiting -> Generating). Only invoked
  // for "queued"/"running" — not for the terminal "done"/"failed" states.
  onPhase?: (p: "queued" | "running") => void;
}

// Reconstructed from the job's `result` to match the shape the old
// synchronous `generateVersion()` returned (VersionCreatedView), so callers
// (useTrustProject's generateVersion/generateFormat) don't need to change
// beyond passing an optional `onPhase`.
export interface GenerateVersionJobResolved {
  id: string;
  artifact_id: string;
  version_no: number;
  created_at: null;
}

export interface UseGenerateVersionJobResult {
  status: GenerateVersionJobUiStatus;
  error: string | null;
  // Submit the whole-book/whole-artifact generate then poll /jobs/{id} until
  // done|failed. Resolves with the reconstructed version on success; throws
  // on failure or timeout (mirrors the pre-async generateVersion()'s
  // throwing-promise contract).
  run: (args: RunGenerateVersionArgs) => Promise<GenerateVersionJobResolved>;
}

// Polls the shared GET /api/v1/jobs/{id} (see trustClient.getGenerateVersionJob)
// until the job reaches done|failed, or bails past POLL_TIMEOUT_MS.
// Injectable interval so tests avoid real timers.
function pollGenerateVersionJob(
  jobId: string,
  accessToken: string,
  intervalMs: number,
  onPhase?: (p: "queued" | "running") => void,
): Promise<GenerateVersionJobStatusView> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  return new Promise<GenerateVersionJobStatusView>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for generation"));
        return;
      }
      try {
        const job = await getGenerateVersionJob(jobId, accessToken);
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

// Submit-then-poll for the Phase C async whole-book/whole-artifact generate
// job. Mirrors useGenerateTopicJob's poll loop, exposed as an imperative
// `run()` since both trust call sites (useTrustProject's generateVersion and
// generateFormat) already own their own busy/error UI state around a single
// awaited promise.
export function useGenerateVersionJob(intervalMs = POLL_INTERVAL_MS): UseGenerateVersionJobResult {
  const [status, setStatus] = useState<GenerateVersionJobUiStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: RunGenerateVersionArgs): Promise<GenerateVersionJobResolved> => {
      setError(null);
      setStatus("generating");
      try {
        const submitted = await generateVersionApi(
          args.artifactId,
          { api_key: args.apiKey, provider_id: args.providerId ?? "anthropic", guidance: args.guidance },
          args.accessToken,
        );
        const job = await pollGenerateVersionJob(submitted.job_id, args.accessToken, intervalMs, args.onPhase);
        if (job.status === "done" && job.result) {
          setStatus("done");
          return { id: job.result.version_id, artifact_id: job.result.artifact_id, version_no: job.result.version_no, created_at: null };
        }
        throw new Error(job.error ?? "Draft generation failed");
      } catch (err) {
        const message =
          err instanceof ApiError ? err.userMessage() : err instanceof Error ? err.message : "Draft generation failed";
        setStatus("failed");
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [intervalMs],
  );

  return { status, error, run };
}
