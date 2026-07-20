// The owner-curated starter list (ADR-028 D5 / P0-5 design A1).
//
// Pure data. No imports, no behavior. **This array is the whole "curation"
// surface** — a source is curated by us if and only if it appears here.
//
// EMPTY ON PURPOSE. P0-5 is designed but not built: nothing seeds a starter
// source yet, and `isStarter`'s only writer (feedStore.ts) hard-codes `false`.
// So today the honest statement is "every source is one the user added", which
// is what the Help says.
//
// This is not a placeholder for its own sake — it is the machine-readable answer
// to "do curated sources exist?", which `__tests__/help/starter-claim.test.ts`
// asserts the Help copy against. Help once promised starter libraries that did
// not exist (closed PR #304); tying the copy to this array is what stops the
// claim and the capability drifting apart again. Populating it (P0-5, design A2
// adds `seedStarterSources`) will fail that test until the copy is updated to
// match — by design.
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
