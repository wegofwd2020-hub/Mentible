import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { pollJob } from "@/api/pollJob";
import { transcribeAudio, type TranscribeJobResult } from "@/api/trustClient";
import type { PickedAudio } from "@/api/audioUpload";

export type TranscribeJobUiStatus = "idle" | "transcribing" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;

export interface RunTranscribeArgs {
  projectId: string;
  asset: PickedAudio;
  language: string;
  title?: string;
  providerId?: string;
  apiKey?: string;
  accessToken: string;
  // Called on each poll tick with the job's current status, for a foreground
  // progress line (Waiting -> Transcribing). Only fires for "queued"/"running".
  onPhase?: (p: "queued" | "running") => void;
}

export interface UseTranscribeJobResult {
  status: TranscribeJobUiStatus;
  error: string | null;
  // Submit the audio upload then poll /jobs/{id} until done|failed. Resolves
  // with the transcript version on success; throws on failure or timeout.
  run: (args: RunTranscribeArgs) => Promise<TranscribeJobResult>;
}

// Submit-then-poll for the STT capture job. Mirrors useGenerateVersionJob: this
// hook owns the multipart submit, the per-hook ui status/error state, and the
// transcription-specific timeout/failure messages; pollJob (@/api/pollJob) owns
// the poll loop.
export function useTranscribeJob(intervalMs = POLL_INTERVAL_MS): UseTranscribeJobResult {
  const [status, setStatus] = useState<TranscribeJobUiStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: RunTranscribeArgs): Promise<TranscribeJobResult> => {
      setError(null);
      setStatus("transcribing");
      try {
        const submitted = await transcribeAudio(
          args.projectId,
          { asset: args.asset, language: args.language, title: args.title, providerId: args.providerId, apiKey: args.apiKey },
          args.accessToken,
        );
        const result = await pollJob<TranscribeJobResult>(submitted.job_id, args.accessToken, {
          intervalMs,
          timeoutMessage: "Timed out waiting for transcription",
          failedMessage: "Transcription failed",
          onPhase: args.onPhase,
        });
        setStatus("done");
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError ? err.userMessage() : err instanceof Error ? err.message : "Transcription failed";
        setStatus("failed");
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [intervalMs],
  );

  return { status, error, run };
}
