// Type-only import — erased at compile, so the trust.ts↔lesson.ts cycle
// (trust.ts imports Provenance from here) is harmless.
import type { TrustManifest } from "@/types/trust";

export interface LessonSection {
  heading: string;
  body_markdown: string;
}

export interface LessonOutput {
  topic: string;
  level: string;
  language: string;
  synopsis: string;
  learning_objectives: string[];
  sections: LessonSection[];
  key_takeaways: string[];
  further_reading: string[];
}

export type JobStatus = "queued" | "running" | "done" | "failed";

// Which LLM + versions produced a generation (backend registry.provenance).
// Stored on the saved unit so we can later detect content made with an outdated
// model/integration and offer to regenerate.
export interface Provenance {
  provider: string;
  model: string;
  model_verified?: boolean;
  integration_version?: number;
  contract_version?: number;
}

// Observed token usage for one generation (SBQ-USAGE-001). The provider returns
// exact counts on every call; the backend sums them across repair attempts, so
// this is real spend, not just the accepted lesson. Metadata only — no key, no
// content. The device appends it to a local usage ledger (see storage/usageStore).
export interface UsageObservation {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  // True when a provider didn't report usage and the seam estimated the counts.
  tokens_estimated: boolean;
  // Total provider calls for this generation (1 = valid first try; >1 = repairs).
  attempts: number;
}

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  result?: LessonOutput;
  provenance?: Provenance;
  // Content Trust Manifest (ADR-015 / SBQ-TRUST-001): provenance + validation +
  // policy at generation; compliance + integrity attach at export. Carries no
  // key material. `provenance` above stays for back-compat with pre-trust jobs.
  trust?: TrustManifest;
  // Observed token usage for this generation (SBQ-USAGE-001). Present on done.
  usage?: UsageObservation;
  error?: string;
}

export interface GenerateRequest {
  request_id: string;
  topic: string;
  level: string;
  language: string;
  // "quiz" (Open Shelves F2) generates a source-grounded QuizSet instead of a
  // lesson — requires `source_text` below (backend 422s a quiz request without
  // it). D13 still holds for the book-authoring lesson path.
  format: "lesson" | "quiz";
  api_key: string;
  // LLM selection (BYOK). Omitted = backend default (anthropic + its default
  // model). The key in api_key must match the chosen provider's format.
  provider_id?: string;
  model?: string;
  depth?: "quick" | "standard" | "deep";
  // Diagram direction for this generation (conceptual ↔ technical). Omitted =
  // backend default ("balanced"). See types/generationParams.ts DiagramRegister.
  diagram_register?: "conceptual" | "balanced" | "technical";
  // Target length in pages for this lesson's prose (excludes quizzes/answers).
  // 0 or omitted = no explicit target. For a book, the client divides the
  // whole-book page target across topics, so this is the per-lesson share.
  target_pages?: number;
  // Free-text author guidance applied on (re)generation — e.g. "add a diagram
  // for the T-shape". Persisted per topic (TopicNode.enhancementInstructions)
  // so it re-applies on every regeneration.
  instructions?: string;
  // The passage a `format:"quiz"` request must be answerable from — an imported
  // chapter's plaintext (@/openshelves/chapterText). Ignored for `format:"lesson"`.
  source_text?: string;
}

export interface GenerateResponse {
  job_id: string;
  status: JobStatus;
}
