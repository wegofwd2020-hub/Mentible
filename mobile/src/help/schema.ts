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
