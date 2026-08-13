import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { pollJob } from "@/api/pollJob";
import { suggestToc as suggestTocApi, type StructuredTocView, type SuggestTocJobResult } from "@/api/trustClient";

export type SuggestTocJobUiStatus = "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;

export interface RunSuggestTocArgs {
  projectId: string;
  apiKey?: string;
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

// Submit-then-poll for the Phase B async suggest-TOC job. Exposed as an
// imperative `run()` (like useGenerateTopicJob.ts) since callers already own
// their own busy/error UI state around a single awaited promise. Polling
// itself is the shared `pollJob` (see @/api/pollJob) — this hook only owns
// the submit call, the per-hook status/error state, and the per-hook
// timeout/failure messages.
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
        const result = await pollJob<SuggestTocJobResult>(submitted.job_id, args.accessToken, {
          intervalMs,
          timeoutMessage: "Timed out waiting for the outline",
          failedMessage: "Couldn't suggest an outline",
          onPhase: args.onPhase,
        });
        setStatus("done");
        return result.toc;
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
