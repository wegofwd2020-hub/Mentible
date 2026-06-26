import { useCallback, useMemo, useRef, useState } from "react";
import { ApiError, pollUntilDone, submitGenerate } from "@/api/client";
import { buildTopicPrompt, buildTopicInstructions } from "@/hooks/topicPrompt";
import { buildGenerateRequest } from "@/lib/buildGenerateRequest";
import { recordUsage } from "@/storage/usageStore";
import type { StructuredTOC, Subtopic } from "@/types/book";
import type { GenerationParams } from "@/types/generationParams";
import type { LessonOutput, Provenance } from "@/types/lesson";

export type TopicRunStatus = "pending" | "generating" | "done" | "failed";

export interface TopicProgress {
  topicId: string;
  title: string;
  status: TopicRunStatus;
  error?: string;
}

interface Target {
  topicId: string;
  title: string;
  subtopics: Subtopic[];
  instructions?: string; // persisted per-topic enhancement guidance
}

interface UseGenerateAllArgs {
  toc: StructuredTOC;
  // The book's generation template (level / depth / pages …). `pages` is the
  // whole-book target, divided evenly across topics into a per-lesson share.
  params: GenerationParams;
  // Resolve the BYOK key lazily so it is read at run time, never held in state.
  getApiKey: () => Promise<string | null>;
  // Called once per topic that completes successfully — persist it here.
  // provenance is the model that produced the lesson (when the backend reported it).
  onTopicDone: (
    topicId: string,
    title: string,
    lesson: LessonOutput,
    provenance?: Provenance,
  ) => void | Promise<void>;
  // Topic ids already generated — shown as done and skipped, so a re-run only
  // fills gaps rather than re-billing the user's key for finished topics.
  alreadyDone?: string[];
  // Injectable poll interval so tests need no real timers.
  intervalMs?: number;
}

export interface UseGenerateAllResult {
  progress: TopicProgress[];
  running: boolean;
  finished: boolean;
  doneCount: number;
  failedCount: number;
  total: number;
  errorMsg: string | null;
  // Run the batch. By default already-generated topics are skipped (gap-fill).
  // Pass { force: true } to regenerate every topic, overwriting existing
  // content — used by the "Regenerate all" action in trial/authoring.
  start: (opts?: { force?: boolean }) => void;
  cancel: () => void;
}

// Client-orchestrated batch over the existing stateless /generate (ADR-003 D3).
// Sequential by design: keeps BYOK cost legible and avoids rate-limit storms.
// One topic failing does not abort the batch — it is recorded and the loop
// continues.
export function useGenerateAll({
  toc,
  params,
  getApiKey,
  onTopicDone,
  alreadyDone,
  intervalMs,
}: UseGenerateAllArgs): UseGenerateAllResult {
  const doneSet = useMemo(() => new Set(alreadyDone ?? []), [alreadyDone]);

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    for (const s of toc.subjects) {
      for (const u of s.units) {
        if (u.id)
          out.push({
            topicId: u.id,
            title: u.title,
            subtopics: u.subtopics,
            instructions: u.enhancementInstructions,
          });
      }
    }
    return out;
  }, [toc]);

  // When forcing a full regenerate, every topic starts pending (even ones that
  // already have content) so the UI shows them all re-running.
  const buildInitialProgress = useCallback(
    (force: boolean): TopicProgress[] =>
      targets.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        status: !force && doneSet.has(t.topicId) ? "done" : "pending",
      })),
    [targets, doneSet],
  );

  const [progress, setProgress] = useState<TopicProgress[]>(() =>
    buildInitialProgress(false),
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cancelledRef = useRef(false);

  const setStatus = useCallback(
    (topicId: string, status: TopicRunStatus, error?: string) => {
      setProgress((prev) =>
        prev.map((p) => (p.topicId === topicId ? { ...p, status, error } : p)),
      );
    },
    [],
  );

  const start = useCallback((opts?: { force?: boolean }) => {
    if (running) return;
    const force = opts?.force ?? false;
    cancelledRef.current = false;
    setErrorMsg(null);
    setFinished(false);
    setProgress(buildInitialProgress(force));
    setRunning(true);

    (async () => {
      const apiKey = await getApiKey();
      if (!apiKey) {
        setErrorMsg("No API key saved. Go to Settings and paste your Anthropic key.");
        setRunning(false);
        return;
      }

      // Divide the whole-book page target evenly across topics. An approximate
      // per-lesson share is fine — the backend treats it as a soft target.
      const perTopicPages =
        params.pages > 0 && targets.length > 0
          ? Math.max(1, Math.round(params.pages / targets.length))
          : 0;

      for (const t of targets) {
        if (cancelledRef.current) break;
        // Skip finished topics on a gap-fill run; on a forced run, redo all.
        if (!force && doneSet.has(t.topicId)) continue;
        setStatus(t.topicId, "generating");
        try {
          const res = await submitGenerate(
            buildGenerateRequest({
              topic: buildTopicPrompt(t.title, t.subtopics),
              apiKey,
              params,
              targetPages: perTopicPages,
              instructions: buildTopicInstructions(t.subtopics, t.instructions),
            }),
          );
          const job = await pollUntilDone(res.job_id, undefined, intervalMs);
          if (cancelledRef.current) break;

          if (job.status === "done" && job.result) {
            // Record observed token usage to the device-local ledger (SBQ-USAGE-001).
            // Fire-and-forget — recordUsage never throws into the batch loop.
            if (job.usage) void recordUsage(job.usage, { topicTitle: t.title });
            // The prompt folds subtopics into the topic line, so the model
            // echoes them back into lesson.topic (the rendered H1 heading).
            // Force the clean topic title so the heading isn't polluted with
            // the subtopic descriptions.
            //
            // Provenance now arrives inside the Content Trust Manifest (ADR-015 /
            // SBQ-TRUST-001); fall back to a bare `provenance` for any pre-trust
            // job still cached at deploy time.
            const provenance = job.trust?.provenance ?? job.provenance;
            await onTopicDone(t.topicId, t.title, { ...job.result, topic: t.title }, provenance);
            setStatus(t.topicId, "done");
          } else {
            setStatus(t.topicId, "failed", job.error ?? "Generation failed");
          }
        } catch (err) {
          if (cancelledRef.current) break;
          // A 429 means we've hit the rate limit — stop the batch rather than
          // hammer it for every remaining topic (each retry only pushes the
          // window further out). Surface the friendly wait message once.
          if (err instanceof ApiError && err.status === 429) {
            const msg = err.userMessage();
            setStatus(t.topicId, "failed", msg);
            setErrorMsg(msg);
            break;
          }
          setStatus(
            t.topicId,
            "failed",
            err instanceof ApiError
              ? err.userMessage()
              : err instanceof Error
                ? err.message
                : "Generation failed",
          );
        }
      }

      setRunning(false);
      if (!cancelledRef.current) setFinished(true);
    })();
  }, [running, targets, doneSet, params, getApiKey, onTopicDone, intervalMs, setStatus, buildInitialProgress]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setRunning(false);
  }, []);

  const doneCount = progress.filter((p) => p.status === "done").length;
  const failedCount = progress.filter((p) => p.status === "failed").length;

  return {
    progress,
    running,
    finished,
    doneCount,
    failedCount,
    total: targets.length,
    errorMsg,
    start,
    cancel,
  };
}
