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

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  result?: LessonOutput;
  provenance?: Provenance;
  // Content Trust Manifest (ADR-015 / SBQ-TRUST-001): provenance + validation +
  // policy at generation; compliance + integrity attach at export. Carries no
  // key material. `provenance` above stays for back-compat with pre-trust jobs.
  trust?: TrustManifest;
  error?: string;
}

export interface GenerateRequest {
  request_id: string;
  topic: string;
  level: string;
  language: string;
  format: "lesson";
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
}

export interface GenerateResponse {
  job_id: string;
  status: JobStatus;
}
