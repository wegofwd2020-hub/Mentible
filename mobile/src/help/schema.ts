// Product-agnostic Help schema (future wegofwd-help). href/step/featureKey are
// plain strings — the consuming app owns route/step/feature validity.
export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: string[] }
  | { kind: "link"; label: string; href: string }
  | { kind: "defs"; defs: { term: string; def: string }[] }
  | { kind: "action"; label: string; step: string };

export interface HelpTopic {
  id: string;
  title: string;
  keywords: string[];
  blocks: HelpBlock[];
  featureKey?: string;
}

// A node in the Help navigation tree (Help Tree Restructure, 2026-08-18).
// Decoupled from HelpTopic on purpose: structure (this) and content
// (HelpTopic) evolve independently. A node is a LEAF when `topicId` is set
// and `children` is not — it renders the referenced HelpTopic's blocks. A
// node is a BRANCH when `children` is set — it renders as a collapsible
// section, and MAY also carry its own `topicId` for branch-level intro
// content. Depth is arbitrary (a tab with several sub-options is 3 levels).
export interface HelpTreeNode {
  id: string;
  title: string;
  blurb?: string;
  topicId?: string;
  children?: HelpTreeNode[];
}
