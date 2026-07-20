import { useCallback, useState } from "react";
import { ApiError, pollUntilDone, submitGenerate } from "@/api/client";
import { IS_DEMO } from "@/constants/demo";
import { randomUUID } from "@/lib/uuid";
import { chapterPlainText } from "@/openshelves/chapterText";
import { loadApiKey } from "@/secure/keyStore";
import { loadBook, saveBook } from "@/storage/bookStore";
import { recordUsage } from "@/storage/usageStore";
import type { QuizSet } from "@/types/book";
import type { GenerateRequest } from "@/types/lesson";

export type ChapterQuizStatus = "idle" | "generating" | "done" | "failed";

export interface UseGenerateChapterQuizResult {
  status: ChapterQuizStatus;
  error: string | null;
  // True after a generation whose source chapter had to be cut to
  // MAX_QUIZ_SOURCE (@/openshelves/chapterText) — the UI (Task 3) surfaces this
  // as a "quiz may miss later material" hint.
  truncated: boolean;
  // Generate a source-grounded quiz for one imported chapter and persist it at
  // book.chapterQuizzes[chapterId]. NEVER writes book.chapters[chapterId].html
  // (the F1 read-only invariant — the chapter is third-party prose we unzipped,
  // this only ever adds a companion entry). Resolves the QuizSet, or null on a
  // handled failure (error is set). Throws only for the demo-build guard, same
  // as submitGenerate's own guard.
  generate: (bookId: string, chapterId: string) => Promise<QuizSet | null>;
}

const DEMO_MESSAGE = "Content generation is disabled in this demo build.";

// Fixed defaults for a chapter quiz: there is no per-chapter generation
// template like a book's GenerationParams — this always asks for a single,
// professional-register, English quiz over exactly the supplied passage.
const QUIZ_LEVEL = "professional";
const QUIZ_LANGUAGE = "en";

// Mirrors useGenerateTopic's submit -> poll -> extract shape, but (unlike that
// stateless hook) this one owns persistence itself: it loads the book, writes
// the result to book.chapterQuizzes, and saves — because a chapter quiz has no
// screen-level "caller holds the book" pattern to hand the result back to.
export function useGenerateChapterQuiz(): UseGenerateChapterQuizResult {
  const [status, setStatus] = useState<ChapterQuizStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const generate = useCallback(
    async (bookId: string, chapterId: string): Promise<QuizSet | null> => {
      // Safety net, same contract as submitGenerate's own IS_DEMO guard: a demo
      // build has no backend, so this must never let a request leave the device.
      if (IS_DEMO) throw new Error(DEMO_MESSAGE);

      setError(null);
      setStatus("generating");

      try {
        const book = await loadBook(bookId);
        const chapter = book?.chapters?.[chapterId];
        if (!book || !chapter) {
          setError("Chapter not found.");
          setStatus("failed");
          return null;
        }

        const apiKey = await loadApiKey(book.generationParams?.provider);
        if (!apiKey) {
          setError("No API key saved. Go to Settings and paste your Anthropic key.");
          setStatus("failed");
          return null;
        }

        const { text: sourceText, truncated: wasTruncated } = chapterPlainText(chapter);
        setTruncated(wasTruncated);

        const req: GenerateRequest = {
          request_id: randomUUID(),
          topic: chapter.title,
          level: QUIZ_LEVEL,
          language: QUIZ_LANGUAGE,
          format: "quiz",
          source_text: sourceText,
          api_key: apiKey,
          ...(book.generationParams?.provider ? { provider_id: book.generationParams.provider } : {}),
        };

        const res = await submitGenerate(req);
        const job = await pollUntilDone(res.job_id);

        if (job.status === "done" && job.result) {
          // The backend's quiz job result is a QuizOutput, field-for-field
          // identical to the mobile QuizSet (Task 1 mirrored it exactly) — but
          // JobResponse.result is typed LessonOutput for the lesson path, so the
          // quiz shape needs this one cast at the boundary.
          const quiz = job.result as unknown as QuizSet;
          await saveBook({
            ...book,
            chapterQuizzes: { ...(book.chapterQuizzes ?? {}), [chapterId]: quiz },
          });
          setStatus("done");
          // Record observed token usage to the device-local ledger (SBQ-USAGE-001)
          // — mirrors useGenerateTopic.ts. A chapter quiz spends real tokens just
          // like a topic generation, and was previously invisible to the usage
          // view. Fire-and-forget — recordUsage never throws into this flow.
          if (job.usage) void recordUsage(job.usage, { topicTitle: chapter.title });
          return quiz;
        }

        setError(job.error ?? "Generation failed");
        setStatus("failed");
        return null;
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.userMessage()
            : err instanceof Error
              ? err.message
              : "Generation failed",
        );
        setStatus("failed");
        return null;
      }
    },
    [],
  );

  return { status, error, truncated, generate };
}
