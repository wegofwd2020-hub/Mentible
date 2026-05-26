import { useCallback, useMemo, useRef, useState } from "react";
import { pollUntilDone, submitGenerate } from "@/api/client";
import type { StructuredTOC } from "@/types/book";
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
}

interface UseGenerateAllArgs {
  toc: StructuredTOC;
  level: string;
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
  start: () => void;
  cancel: () => void;
}

function randomRequestId(): string {
  return crypto.randomUUID();
}

// A book's topic carries its subtopics as scope; fold them into the prompt so
// the generated lesson stays on-topic within the book.
function buildTopicPrompt(t: Target): string {
  if (t.subtopics.length === 0) return t.title;
  return `${t.title} — covering: ${t.subtopics.join(", ")}`;
}

// Client-orchestrated batch over the existing stateless /generate (ADR-003 D3).
// Sequential by design: keeps BYOK cost legible and avoids rate-limit storms.
// One topic failing does not abort the batch — it is recorded and the loop
// continues.
export function useGenerateAll({
  toc,
  level,
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
        if (u.id) out.push({ topicId: u.id, title: u.title, subtopics: u.subtopics });
      }
    }
    return out;
  }, [toc]);

  const initialProgress = useCallback(
    (): TopicProgress[] =>
      targets.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        status: doneSet.has(t.topicId) ? "done" : "pending",
      })),
    [targets, doneSet],
  );

  const [progress, setProgress] = useState<TopicProgress[]>(initialProgress);
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

  const start = useCallback(() => {
    if (running) return;
    cancelledRef.current = false;
    setErrorMsg(null);
    setFinished(false);
    setProgress(initialProgress());
    setRunning(true);

    (async () => {
      const apiKey = await getApiKey();
      if (!apiKey) {
        setErrorMsg("No API key saved. Go to Settings and paste your Anthropic key.");
        setRunning(false);
        return;
      }

      for (const t of targets) {
        if (cancelledRef.current) break;
        if (doneSet.has(t.topicId)) continue; // already generated — skip
        setStatus(t.topicId, "generating");
        try {
          const res = await submitGenerate({
            request_id: randomRequestId(),
            topic: buildTopicPrompt(t),
            level,
            language: "en",
            format: "lesson",
            depth: "standard",
            api_key: apiKey,
          });
          const job = await pollUntilDone(res.job_id, undefined, intervalMs);
          if (cancelledRef.current) break;

          if (job.status === "done" && job.result) {
            await onTopicDone(t.topicId, t.title, job.result);
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
  }, [running, targets, doneSet, level, getApiKey, onTopicDone, intervalMs, setStatus, initialProgress]);

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
