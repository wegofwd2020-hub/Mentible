// wegofwd-help (in-repo). Extraction injection points when this becomes a package:
// the render components (Task 2) import `@/constants/theme` (tokens) and
// `expo-router` (HelpButton nav) — parameterize those on extraction. See
// docs/superpowers/specs/2026-07-06-help-engine-seam-design.md.
export type { HelpBlock, HelpTopic } from "./schema";
export { blockText, searchHelpTopics } from "./search";
export { uncoveredFeatures } from "./coverage";
