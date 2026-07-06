// Feature keys with no covering topic. Loose param types so a synthetic FEATURES
// list can be passed in tests.
export function uncoveredFeatures(
  features: readonly { key: string }[],
  topics: readonly { featureKey?: string }[],
): string[] {
  const covered = new Set(topics.map((t) => t.featureKey).filter((k): k is string => Boolean(k)));
  return features.map((f) => f.key).filter((k) => !covered.has(k));
}
