import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { pollJob } from "@/api/pollJob";
import { generateTopic as generateTopicApi, type TopicGenerateJobResult } from "@/api/trustClient";

export type TopicGenerateJobUiStatus = "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;

export interface RunGenerateTopicArgs {
  projectId: string;
  topicId: string;
  apiKey: string;
  accessToken: string;
  providerId?: string;
  guidance?: string;
  // Called on each poll tick with the job's current status, for callers
  // driving a foreground progress bar (Waiting -> Generating). Only invoked
  // for "queued"/"running" — not for the terminal "done"/"failed" states.
  onPhase?: (p: "queued" | "running") => void;
}

export interface UseGenerateTopicJobResult {
  status: TopicGenerateJobUiStatus;
  error: string | null;
  // Submit the per-topic generate then poll /jobs/{id} until done|failed.
  // Resolves with the job's result on success; throws on failure or timeout
  // (mirrors the pre-async generateTopic()'s throwing-promise contract so
  // existing call sites — DraftsPanel's onGenerateTopic, the topic-viewer's
  // doRegen — need no shape changes).
  run: (args: RunGenerateTopicArgs) => Promise<TopicGenerateJobResult>;
}

// Submit-then-poll for the Phase A async per-topic generate job. Mirrors
// useStructureJob's poll loop, but exposed as an imperative `run()` (like
// useGenerateTopic.ts's book-authoring counterpart) since both trust call
// sites already own their own busy/error UI state around a single awaited
// promise, rather than subscribing to a live jobId the way the Structure
// screen's suggest-outline flow does. Polling itself is the shared
// `pollJob` (see @/api/pollJob) — this hook only owns the submit call, the
// per-hook status/error state, and the per-hook timeout/failure messages.
export function useGenerateTopicJob(intervalMs = POLL_INTERVAL_MS): UseGenerateTopicJobResult {
  const [status, setStatus] = useState<TopicGenerateJobUiStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: RunGenerateTopicArgs): Promise<TopicGenerateJobResult> => {
      setError(null);
      setStatus("generating");
      try {
        const submitted = await generateTopicApi(
          args.projectId,
          args.topicId,
          { api_key: args.apiKey, provider_id: args.providerId ?? "anthropic", guidance: args.guidance },
          args.accessToken,
        );
        const result = await pollJob<TopicGenerateJobResult>(submitted.job_id, args.accessToken, {
          intervalMs,
          timeoutMessage: "Timed out waiting for generation",
          failedMessage: "Generation failed",
          onPhase: args.onPhase,
        });
        setStatus("done");
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError ? err.userMessage() : err instanceof Error ? err.message : "Generation failed";
        setStatus("failed");
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [intervalMs],
  );

  return { status, error, run };
}
