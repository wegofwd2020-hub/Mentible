import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { makeCard, type CardSize, type MakeCardResponse } from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

export type MakeCardStatus = "idle" | "generating" | "done" | "failed";

interface UseMakeCardArgs {
  // Resolve the BYOK key lazily so it is read at run time, never held in state.
  getApiKey: () => Promise<string | null>;
}

// Exactly one of source_text / topic_version_id — the caller (the Publish
// screen's card mode) enforces that, this hook just forwards it.
export interface RunCardArgs {
  source_text?: string;
  topic_version_id?: string;
  size: CardSize;
  tone?: string;
}

export interface UseMakeCardResult {
  status: MakeCardStatus;
  error: string | null;
  result: MakeCardResponse | null;
  run: (args: RunCardArgs) => Promise<void>;
  reset: () => void;
}

// Stateless one-shot: source text OR a validated topic-version -> one branded
// image card over the synchronous /derivatives/card endpoint (no polling). A
// Pro plan's managed key covers the vendor call, so a missing BYOK key only
// blocks Free/unknown-plan users — mirrors useMakePost's guard exactly.
export function useMakeCard({ getApiKey }: UseMakeCardArgs): UseMakeCardResult {
  const [status, setStatus] = useState<MakeCardStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MakeCardResponse | null>(null);

  // Fail-open: while the plan is loading (plan == null) or Pro, a no-key run
  // goes keyless and the backend decides.
  const { plan } = useBillingPlan();
  const knownNotPro = plan != null && plan.is_pro === false;

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  const run = useCallback(
    async ({ source_text, topic_version_id, size, tone }: RunCardArgs): Promise<void> => {
      setError(null);
      setStatus("generating");

      const apiKey = await getApiKey();
      if (!apiKey && knownNotPro) {
        setError("No API key saved. Go to Settings and paste your Anthropic key.");
        setStatus("failed");
        return;
      }

      try {
        const res = await makeCard({
          ...(topic_version_id ? { topic_version_id } : { source_text }),
          size,
          ...(tone ? { tone } : {}),
          // Never send api_key: "" — omit the field entirely for a keyless
          // (managed-plan) request.
          ...(apiKey ? { api_key: apiKey } : {}),
          provider_id: "anthropic",
        });
        setResult(res);
        setStatus("done");
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.userMessage()
            : err instanceof Error
              ? err.message
              : "Could not make a card.",
        );
        setStatus("failed");
      }
    },
    [getApiKey, knownNotPro],
  );

  return { status, error, result, run, reset };
}
