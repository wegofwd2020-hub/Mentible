import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { generateTopic as generateTopicApi, getJob, type TopicGenerateJobResult, type TopicGenerateJobStatusView } from "@/api/trustClient";

export type TopicGenerateJobUiStatus = "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;
// Same rationale as client.ts's POLL_TIMEOUT_MS for the whole-lesson /generate
// poll — a topic draft can legitimately take minutes, and a schema-repair
// retry loop can push that further.
const POLL_TIMEOUT_MS = 600_000;

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

// Polls the shared GET /api/v1/jobs/{id} (see trustClient.getJob) until the
// job reaches done|failed, or bails past POLL_TIMEOUT_MS. Injectable interval
// so tests avoid real timers.
function pollTopicJob(
  jobId: string,
  accessToken: string,
  intervalMs: number,
  onPhase?: (p: "queued" | "running") => void,
): Promise<TopicGenerateJobStatusView> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  return new Promise<TopicGenerateJobStatusView>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for generation"));
        return;
      }
      try {
        const job = await getJob(jobId, accessToken);
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

// Submit-then-poll for the Phase A async per-topic generate job. Mirrors
// useStructureJob's poll loop, but exposed as an imperative `run()` (like
// useGenerateTopic.ts's book-authoring counterpart) since both trust call
// sites already own their own busy/error UI state around a single awaited
// promise, rather than subscribing to a live jobId the way the Structure
// screen's suggest-outline flow does.
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
        const job = await pollTopicJob(submitted.job_id, args.accessToken, intervalMs, args.onPhase);
        if (job.status === "done" && job.result) {
          setStatus("done");
          return job.result;
        }
        throw new Error(job.error ?? "Generation failed");
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
