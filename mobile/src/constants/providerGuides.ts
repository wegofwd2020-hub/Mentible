// How to obtain an API key for each BYOK provider. This is the single source for
// the per-provider "get a key" guidance shown both in the onboarding KeyStep
// (with an "open console" button) and in the Help screen (provider-keys topic),
// so the two never drift. Key shape (prefix / placeholder) stays in
// constants/providers.ts — this file only adds the acquisition story.

import { PROVIDERS } from "@/constants/providers";

export type ProviderCost = "paid" | "free" | "free-tier";

export interface ProviderGuide {
  id: string; // matches ProviderInfo.id
  consoleUrl: string; // full https URL the "Get a key" button opens
  consoleLabel: string; // host shown on the button / in help text
  cost: ProviderCost;
  costNote: string; // one-line, plain-language cost summary
  steps: string[]; // how to get the key (rendered numbered)
}

export const COST_LABEL: Record<ProviderCost, string> = {
  paid: "Paid",
  free: "Free to start",
  "free-tier": "Free to start",
};

export const PROVIDER_GUIDES: Record<string, ProviderGuide> = {
  anthropic: {
    id: "anthropic",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    consoleLabel: "console.anthropic.com",
    cost: "paid",
    costNote:
      "Paid — Anthropic bills you per token. Highest output quality; recommended for finished books.",
    steps: [
      "Open console.anthropic.com and sign up or log in.",
      "Under Billing, add a payment method and a little credit (Claude has no free tier).",
      "Go to Settings → API Keys and choose Create Key.",
      "Copy the key (it starts with sk-ant-) and paste it below.",
    ],
  },
  openai: {
    id: "openai",
    consoleUrl: "https://platform.openai.com/api-keys",
    consoleLabel: "platform.openai.com",
    cost: "paid",
    costNote: "Paid — OpenAI bills you per token (new accounts may get limited trial credit).",
    steps: [
      "Open platform.openai.com and sign up or log in.",
      "Add billing under Settings → Billing if you have no trial credit.",
      "Go to API keys → Create new secret key.",
      "Copy the key (it starts with sk-) and paste it below.",
    ],
  },
  groq: {
    id: "groq",
    consoleUrl: "https://console.groq.com/keys",
    consoleLabel: "console.groq.com",
    cost: "free",
    costNote: "Free to start — fast open models, no card required. Great for trying Mentible; output is draft-grade.",
    steps: [
      "Open console.groq.com and sign up (Google or GitHub works).",
      "Go to API Keys → Create API Key.",
      "Copy the key (it starts with gsk_) and paste it below.",
    ],
  },
  openrouter: {
    id: "openrouter",
    consoleUrl: "https://openrouter.ai/keys",
    consoleLabel: "openrouter.ai",
    cost: "free-tier",
    costNote: "Free to start: model variants available (paid models too) — one key, many models. Output is draft-grade.",
    steps: [
      "Open openrouter.ai and sign up or log in.",
      "Go to Keys → Create Key.",
      "Copy the key (it starts with sk-or-) and paste it below.",
      "Pick a model whose name ends in “:free” to stay at no cost.",
    ],
  },
  gemini: {
    id: "gemini",
    consoleUrl: "https://aistudio.google.com/app/apikey",
    consoleLabel: "aistudio.google.com",
    cost: "free-tier",
    costNote: "Free to start via Google AI Studio (rate-limited). Output is draft-grade.",
    steps: [
      "Open aistudio.google.com and sign in with a Google account.",
      "Click Get API key → Create API key.",
      "Copy the key (it starts with AIza) and paste it below.",
    ],
  },
};

export function providerGuide(id: string): ProviderGuide | null {
  return PROVIDER_GUIDES[id] ?? null;
}

// Ordered guides matching the provider picker order (providers.ts is the source
// of truth for which providers exist and in what order).
export function orderedGuides(): { label: string; keyHint: string; guide: ProviderGuide }[] {
  return PROVIDERS.flatMap((p) => {
    const guide = PROVIDER_GUIDES[p.id];
    return guide ? [{ label: p.label, keyHint: p.keyHint, guide }] : [];
  });
}
