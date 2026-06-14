import { trustManifestFromTopic } from "@/lib/topicTrust";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";

// trustManifestFromTopic surfaces a topic's stored provenance as a manifest for
// the badge (ADR-016 D7 — no new generation data). It must never invent a signal:
// no provenance ⇒ no badge; a persisted backend manifest wins as-is.

const lesson: LessonOutput = {
  topic: "T",
  level: "Grade 11",
  language: "en",
  synopsis: "s",
  learning_objectives: [],
  sections: [],
  key_takeaways: [],
  further_reading: [],
};

function topic(extra: Partial<GeneratedTopic> = {}): GeneratedTopic {
  return { topicId: "t1", title: "T", lesson, generatedAt: "2026-06-14T12:00:00Z", ...extra };
}

describe("trustManifestFromTopic", () => {
  it("returns null when the topic has no provenance (imported / pre-3c)", () => {
    expect(trustManifestFromTopic(topic())).toBeNull();
  });

  it("builds a manifest from stored provenance + generatedAt", () => {
    const m = trustManifestFromTopic(
      topic({ provenance: { provider: "anthropic", model: "claude-sonnet-4-6", model_verified: true } }),
    );
    expect(m).not.toBeNull();
    expect(m!.provenance.model).toBe("claude-sonnet-4-6");
    expect(m!.provenance.generated_at).toBe("2026-06-14T12:00:00Z");
    // stored content necessarily passed the pipeline schema gate
    expect(m!.validation.schema_validated).toBe(true);
    // standing BYOK posture is surfaced
    expect(m!.policy).toEqual({ byok: true, prompts_stored: false, key_stored: false });
    // book-level blocks are not asserted at the unit level
    expect(m!.compliance).toBeUndefined();
    expect(m!.integrity).toBeUndefined();
  });

  it("prefers a backend-persisted manifest verbatim when present", () => {
    const persisted = {
      trust_manifest_version: 1,
      provenance: { provider: "anthropic", model: "claude-opus-4-8", model_verified: true },
      validation: { schema_validated: true, repair_attempts: 2 },
    };
    const m = trustManifestFromTopic(topic({ trust: persisted, provenance: { provider: "x", model: "y" } }));
    expect(m).toBe(persisted); // not rebuilt from provenance
  });
});
