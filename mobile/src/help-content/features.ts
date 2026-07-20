// The user-facing features that MUST have in-app help (coverage gate). Adding a
// feature here requires a topic with the matching featureKey (see
// __tests__/help/coverage.test.ts).
export const FEATURES = [
  { key: "generation", label: "Generating a book" },
  { key: "reading", label: "Reading a book" },
  { key: "provider-keys", label: "Provider API keys (BYOK)" },
  { key: "diagrams", label: "Diagrams" },
  { key: "export", label: "Export (EPUB3 / PDF)" },
  { key: "sharing", label: "Draft sharing" },
  { key: "accounts", label: "Accounts & sign-in" },
  { key: "plans", label: "Plans & billing" },
  { key: "figures", label: "Figures (attached images)" },
  { key: "open-shelves", label: "Open Shelves (free book repos)" },
  { key: "imported-books", label: "Reading imported books" },
  { key: "chapter-quiz", label: "Chapter quiz (imported books)" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
