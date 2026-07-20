// The owner-curated starter list (ADR-028 D5 / P0-5 design A1).
//
// Pure data. No imports, no behavior. **This array is the whole "curation"
// surface** — a source is curated by us if and only if it appears here.
//
// POPULATED (P0-5, 2026-07-20). These four Gutenberg shelves are seeded on first
// run by `seedStarterSources.ts` (design A2) and marked `isStarter: true`.
//
// This array is the machine-readable answer to "do curated sources exist?", which
// `__tests__/help/starter-claim.test.ts` asserts the Help copy against: because it
// is now non-empty, the Help must affirm curated/starter sources (and it does).
// Help once promised starter libraries that did not exist (closed PR #304); tying
// the copy to this array is what stops the claim and the capability drifting apart.
export interface StarterSource {
  url: string;
  title: string;
}

export const STARTER_SOURCES: StarterSource[] = [
  { url: "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads", title: "Project Gutenberg — Popular" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=science",       title: "Project Gutenberg — Science" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=children",      title: "Project Gutenberg — Children's" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=history",       title: "Project Gutenberg — History" },
];
