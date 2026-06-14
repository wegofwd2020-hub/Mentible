// Content Trust Manifest — the customer-facing record of how a unit of curated
// content was produced and which quality/compliance gates it passed. Mirrors the
// shape owned by wegofwd-llm (ADR-015, wegofwd_llm/trust.py) so the backend can
// serialise it and the front-end renders it without re-deriving any fact.
//
// The seam fills `provenance` + `validation`; the backend packager attaches the
// rest. A block left undefined renders as "not assessed" — never as a pass.

import type { Provenance } from "@/types/lesson";

// provenance reuses the existing Provenance type + the caller-stamped timestamp.
export interface TrustProvenance extends Provenance {
  generated_at?: string; // ISO-8601 UTC
}

export interface TrustValidation {
  schema_validated: boolean;
  repair_attempts?: number;
  schema_id?: string;
}

export interface TrustCompliance {
  ruleset: string; // "mentible-professional@1.0"
  checks_passed: number;
  checks_total: number;
  status: "pass" | "pass_with_notes" | "fail";
}

export interface TrustIntegrity {
  content_hash: string; // "sha256:…"
  signed?: boolean;
}

export interface TrustSourcing {
  every_claim_cited: boolean;
  source_refs?: number;
}

export interface TrustReview {
  human_approved: boolean;
  approver_distinct_from_generator?: boolean;
}

export interface TrustPolicy {
  byok: boolean;
  prompts_stored: boolean;
  key_stored: boolean;
}

export interface TrustManifest {
  trust_manifest_version: number;
  provenance: TrustProvenance;
  validation: TrustValidation;
  compliance?: TrustCompliance;
  integrity?: TrustIntegrity;
  sourcing?: TrustSourcing;
  review?: TrustReview;
  policy?: TrustPolicy;
}
