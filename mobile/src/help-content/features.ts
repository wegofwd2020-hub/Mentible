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
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
