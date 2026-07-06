// TEMP compatibility shim (Help engine/content seam). Re-exports the engine
// (@/help) + content (@/help-content) so existing imports keep working while the
// seam lands. Deleted in Task 3.
import { searchHelpTopics as _search, type HelpTopic } from "@/help";
import { HELP_TOPICS } from "@/help-content";

export type { HelpBlock, HelpTopic } from "@/help";
export { blockText, uncoveredFeatures } from "@/help";
export { FEATURES, type FeatureKey } from "@/help-content";
export { HELP_TOPICS } from "@/help-content";

// Preserve the original default-arg behaviour for callers that pass only a query.
export function searchHelpTopics(query: string, topics: HelpTopic[] = HELP_TOPICS): HelpTopic[] {
  return _search(query, topics);
}
