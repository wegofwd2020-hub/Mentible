import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { pollJob } from "@/api/pollJob";
import { generateVersion as generateVersionApi, type GenerateVersionJobResult } from "@/api/trustClient";

export type GenerateVersionJobUiStatus = "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;

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

// Submit-then-poll for the Phase C async whole-book/whole-artifact generate
// job. Mirrors useGenerateTopicJob's poll loop, exposed as an imperative
// `run()` since both trust call sites (useTrustProject's generateVersion and
// generateFormat) already own their own busy/error UI state around a single
// awaited promise. Polling itself is the shared `pollJob` (see
// @/api/pollJob) — this hook only owns the submit call, the per-hook
// status/error state, and the per-hook timeout/failure messages.
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
        const result = await pollJob<GenerateVersionJobResult>(submitted.job_id, args.accessToken, {
          intervalMs,
          timeoutMessage: "Timed out waiting for generation",
          failedMessage: "Draft generation failed",
          onPhase: args.onPhase,
        });
        setStatus("done");
        return { id: result.version_id, artifact_id: result.artifact_id, version_no: result.version_no, created_at: null };
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
