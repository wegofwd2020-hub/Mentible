import { useCallback, useState } from "react";
import { pollUntilDone, submitGenerate } from "@/api/client";
import { buildTopicPrompt } from "@/hooks/topicPrompt";
import { buildGenerateRequest } from "@/lib/buildGenerateRequest";
import type { GenerationParams } from "@/types/generationParams";
import type { LessonOutput } from "@/types/lesson";

export type TopicGenStatus = "idle" | "generating" | "done" | "failed";

interface UseGenerateTopicArgs {
  // Resolve the BYOK key lazily so it is read at run time, never held in state.
  getApiKey: () => Promise<string | null>;
  // Injectable poll interval so tests need no real timers.
  intervalMs?: number;
}

export interface RunTopicArgs {
  title: string;
  subtopics: string[];
  // The book's generation template (level / depth / pages).
  params: GenerationParams;
  // Persisted per-topic enhancement guidance applied on this (re)generation.
  instructions?: string;
}

export interface UseGenerateTopicResult {
  status: TopicGenStatus;
  error: string | null;
  // Generate one topic against the user's key and resolve with the lesson, or
  // null on failure (error is set). The caller persists the result — this hook
  // is stateless about the book.
  run: (args: RunTopicArgs) => Promise<LessonOutput | null>;
}

// Single-topic generate over the same stateless /generate the batch loop uses.
// Used for "Regenerate this topic" so an author can iterate on one lesson
// without re-running the whole book (ADR-003 per-topic regenerate).
export function useGenerateTopic({
  getApiKey,
  intervalMs,
}: UseGenerateTopicArgs): UseGenerateTopicResult {
  const [status, setStatus] = useState<TopicGenStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async ({ title, subtopics, params, instructions }: RunTopicArgs): Promise<LessonOutput | null> => {
      setError(null);
      setStatus("generating");

      const apiKey = await getApiKey();
      if (!apiKey) {
        setError("No API key saved. Go to Settings and paste your Anthropic key.");
        setStatus("failed");
        return null;
      }

      try {
        const res = await submitGenerate(
          buildGenerateRequest({
            topic: buildTopicPrompt(title, subtopics),
            apiKey,
            params,
            instructions,
          }),
        );
        const job = await pollUntilDone(res.job_id, undefined, intervalMs);

        if (job.status === "done" && job.result) {
          setStatus("done");
          // Force the clean topic title as the heading — the prompt folds
          // subtopics into the topic line and the model echoes them into
          // lesson.topic (the rendered H1), which pollutes the heading.
          return { ...job.result, topic: title };
        }
        setError(job.error ?? "Generation failed");
        setStatus("failed");
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Generation failed");
        setStatus("failed");
        return null;
      }
    },
    [getApiKey, intervalMs],
  );

  return { status, error, run };
}
