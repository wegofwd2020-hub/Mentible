import { uncoveredFeatures } from "@/help";
import { FEATURES, HELP_TOPICS } from "@/help-content";

describe("help coverage gate", () => {
  it("every declared feature has at least one Help topic", () => {
    // If this fails, add a topic (with the right featureKey) for each key listed.
    expect(uncoveredFeatures(FEATURES, HELP_TOPICS)).toEqual([]);
  });

  it("uncoveredFeatures actually flags a feature with no topic (the gate bites)", () => {
    const synthetic = [...FEATURES, { key: "not-documented", label: "X" }];
    expect(uncoveredFeatures(synthetic, HELP_TOPICS)).toEqual(["not-documented"]);
  });

  it("no topic references a featureKey that isn't in FEATURES", () => {
    const valid = new Set<string>(FEATURES.map((f) => f.key));
    const orphans = HELP_TOPICS.filter((t) => t.featureKey && !valid.has(t.featureKey)).map((t) => t.id);
    expect(orphans).toEqual([]);
  });
});
