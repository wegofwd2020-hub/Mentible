import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { makePost, type Platform, type PostVariant } from "@/api/derivativesClient";

export type MakePostStatus = "idle" | "generating" | "done" | "failed";

interface UseMakePostArgs {
  // Resolve the BYOK key lazily so it is read at run time, never held in state.
  getApiKey: () => Promise<string | null>;
}

export interface RunPostArgs {
  sourceText: string;
  platform: Platform;
  tone?: string;
}

export interface UseMakePostResult {
  status: MakePostStatus;
  error: string | null;
  variants: PostVariant[];
  provenance: string | null;
  run: (args: RunPostArgs) => Promise<void>;
  reset: () => void;
}

// Stateless one-shot: source text -> 3 platform-scoped post variants over the
// synchronous /derivatives/post endpoint (no polling). BYOK-only — a missing
// key is a friendly hard failure, mirroring useGenerateTopic's guard.
export function useMakePost({ getApiKey }: UseMakePostArgs): UseMakePostResult {
  const [status, setStatus] = useState<MakePostStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<PostVariant[]>([]);
  const [provenance, setProvenance] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setVariants([]);
    setProvenance(null);
  }, []);

  const run = useCallback(
    async ({ sourceText, platform, tone }: RunPostArgs): Promise<void> => {
      setError(null);
      setStatus("generating");

      const apiKey = await getApiKey();
      if (!apiKey) {
        setError("No API key saved. Go to Settings and paste your Anthropic key.");
        setStatus("failed");
        return;
      }

      try {
        const res = await makePost({
          source_text: sourceText,
          platform,
          ...(tone ? { tone } : {}),
          api_key: apiKey,
          provider_id: "anthropic",
        });
        setVariants(res.variants);
        setProvenance(res.provenance);
        setStatus("done");
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.userMessage()
            : err instanceof Error
              ? err.message
              : "Could not make a post.",
        );
        setStatus("failed");
      }
    },
    [getApiKey],
  );

  return { status, error, variants, provenance, run, reset };
}
