import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateAndStoreTopicAudio } from "@/lib/audioGenerate";
import { lessonToNarratableText } from "@/lib/lessonToNarratableText";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import type { Book } from "@/types/book";

export type NarrationRunStatus = "pending" | "generating" | "done" | "failed";

export interface NarrationProgress {
  topicId: string;
  title: string;
  status: NarrationRunStatus;
  error?: string;
}

interface Target {
  topicId: string;
  title: string;
  hasAudio: boolean;
}

interface UseGenerateAllNarrationArgs {
  book: Book;
  // Resolve the OpenAI key lazily so it is read at run time, never held in
  // state (ADR-001).
  getApiKey: () => Promise<string | null>;
  // Called once per topic that completes successfully — persist it here. The
  // hook threads the returned book onto the next topic's call.
  onBookChange: (book: Book) => void | Promise<void>;
  // Injectable delay between topics so tests need no real timers.
  intervalMs?: number;
}

export interface UseGenerateAllNarrationResult {
  progress: NarrationProgress[];
  running: boolean;
  finished: boolean;
  doneCount: number;
  failedCount: number;
  total: number;
  errorMsg: string | null;
  start: () => void;
  cancel: () => void;
}

// Delay helper — resolves immediately when ms is falsy so tests (intervalMs: 0)
// never touch real timers.
function delay(ms?: number): Promise<void> {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Client-orchestrated batch narration over the shipped per-topic
// generateAndStoreTopicAudio (ADR-040 rung 4). Mirrors useGenerateAll's shape
// and sequencing exactly, but narrates instead of generating lesson text: one
// topic at a time, a topic already carrying audio is skipped (resumable
// gap-fill — no "force" here, a narration cap makes force ambiguous), and one
// topic's failure is recorded without aborting the rest of the batch.
export function useGenerateAllNarration({
  book,
  getApiKey,
  onBookChange,
  intervalMs,
}: UseGenerateAllNarrationArgs): UseGenerateAllNarrationResult {
  // A Pro plan's managed key covers the vendor call, so a missing key only
  // blocks Free/unknown-plan users. Fail-open: while the plan is loading
  // (plan == null) or Pro, a no-key run goes keyless and the backend decides.
  const { plan } = useBillingPlan();
  const knownNotPro = plan != null && plan.is_pro === false;

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    for (const [topicId, topic] of Object.entries(book.content ?? {})) {
      if (!topic?.lesson) continue;
      out.push({ topicId, title: topic.title, hasAudio: !!topic.audio?.length });
    }
    return out;
  }, [book]);

  const buildInitialProgress = useCallback(
    (): NarrationProgress[] =>
      targets.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        status: t.hasAudio ? "done" : "pending",
      })),
    [targets],
  );

  const [progress, setProgress] = useState<NarrationProgress[]>(() => buildInitialProgress());
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Re-seed as the book's topics/audio arrive so the list reflects the latest
  // book, without clobbering an in-flight run's live statuses.
  useEffect(() => {
    if (running) return;
    setProgress((prev) => {
      const sameTopics =
        prev.length === targets.length &&
        prev.every((p, i) => p.topicId === targets[i].topicId);
      return sameTopics ? prev : buildInitialProgress();
    });
  }, [targets, running, buildInitialProgress]);

  const cancelledRef = useRef(false);
  // Track the live book across the loop so each successful call attaches
  // onto the previous topic's result rather than a stale snapshot.
  const bookRef = useRef(book);
  useEffect(() => {
    if (!running) bookRef.current = book;
  }, [book, running]);

  const setStatus = useCallback(
    (topicId: string, status: NarrationRunStatus, error?: string) => {
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
    setProgress(buildInitialProgress());
    setRunning(true);

    (async () => {
      const apiKey = await getApiKey();
      if (!apiKey && knownNotPro) {
        setErrorMsg("No API key saved. Go to Settings and paste your OpenAI key.");
        setRunning(false);
        return;
      }

      let currentBook = bookRef.current;

      for (const t of targets) {
        if (cancelledRef.current) break;
        if (t.hasAudio) continue; // resumable gap-fill — skip already-narrated topics
        const topic = currentBook.content?.[t.topicId];
        if (!topic?.lesson) continue;

        setStatus(t.topicId, "generating");
        try {
          const { book: next } = await generateAndStoreTopicAudio({
            book: currentBook,
            topicId: t.topicId,
            source_text: lessonToNarratableText(topic.lesson),
            provider_id: "openai",
            ...(apiKey ? { apiKey } : {}),
          });
          if (cancelledRef.current) break;
          await onBookChange(next);
          currentBook = next;
          bookRef.current = next;
          setStatus(t.topicId, "done");
        } catch (err) {
          if (cancelledRef.current) break;
          setStatus(t.topicId, "failed", err instanceof Error ? err.message : "Narration failed");
        }

        if (cancelledRef.current) break;
        await delay(intervalMs);
      }

      setRunning(false);
      if (!cancelledRef.current) setFinished(true);
    })();
  }, [running, targets, getApiKey, onBookChange, intervalMs, setStatus, buildInitialProgress, knownNotPro]);

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
