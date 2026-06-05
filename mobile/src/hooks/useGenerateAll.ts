import { useCallback, useMemo, useRef, useState } from "react";
import { pollUntilDone, submitGenerate } from "@/api/client";
import { buildTopicPrompt } from "@/hooks/topicPrompt";
import { buildGenerateRequest } from "@/lib/buildGenerateRequest";
import type { StructuredTOC } from "@/types/book";
import type { GenerationParams } from "@/types/generationParams";
import type { LessonOutput } from "@/types/lesson";

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
  subtopics: string[];
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
  onTopicDone: (topicId: string, title: string, lesson: LessonOutput) => void | Promise<void>;
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
              instructions: t.instructions,
            }),
          );
          const job = await pollUntilDone(res.job_id, undefined, intervalMs);
          if (cancelledRef.current) break;

          if (job.status === "done" && job.result) {
            // The prompt folds subtopics into the topic line, so the model
            // echoes them back into lesson.topic (the rendered H1 heading).
            // Force the clean topic title so the heading isn't polluted with
            // the subtopic descriptions.
            await onTopicDone(t.topicId, t.title, { ...job.result, topic: t.title });
            setStatus(t.topicId, "done");
          } else {
            setStatus(t.topicId, "failed", job.error ?? "Generation failed");
          }
        } catch (err) {
          if (cancelledRef.current) break;
          setStatus(t.topicId, "failed", err instanceof Error ? err.message : "Generation failed");
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
