// Adapt a stored book topic into a ContentTrustManifest for the <TrustBadge>
// (ADR-015 surface; ADR-016 D6/D7 make per-unit provenance a requirement).
//
// ADR-016 D7 is explicit that the indicator is "sourced from the already-stored
// Provenance + book/topic metadata — no new generation data is required", so this
// surfaces what the topic already carries rather than waiting on backend wiring.

import type { GeneratedTopic } from "@/types/book";
import type { TrustManifest } from "@/types/trust";

// Standing BYOK data posture for this product (ADR-001 / CLAUDE.md): the author's
// key is theirs, and we persist neither prompts nor the key. True for every unit,
// so it's a constant here, not per-generation data.
const BYOK_POLICY = { byok: true, prompts_stored: false, key_stored: false } as const;

/**
 * Build the trust manifest a topic's badge renders.
 *
 * Prefers a full manifest persisted by the backend (`topic.trust`, once
 * SBQ-TRUST-001's worker wiring lands). Otherwise assembles one from the stored
 * `provenance` + `generatedAt`. Returns `null` when there's no provenance to show
 * (pre-Phase-3c units / imported books) — the badge is omitted rather than
 * rendered with an unknown LLM (honest "not assessed", never a silent pass).
 */
export function trustManifestFromTopic(topic: GeneratedTopic): TrustManifest | null {
  if (topic.trust) return topic.trust;

  const p = topic.provenance;
  if (!p) return null;

  return {
    trust_manifest_version: 1,
    provenance: { ...p, generated_at: topic.generatedAt },
    // The pipeline validates every response against the lesson schema before
    // returning (retry-or-fail), so stored content necessarily passed — a sound
    // inference, not stored data. `repair_attempts` isn't persisted, so it's left
    // off (the badge then reads a clean pass without claiming auto-correction).
    validation: { schema_validated: true },
    policy: BYOK_POLICY,
    // compliance/integrity are book-level, attached at export (SBQ-TRUST-002) —
    // unset here so the badge renders them as "not assessed", never a pass.
  };
}
