// Authoring vocabulary — centralised so user-facing copy is a one-line change.
//
// Voice per docs/adr/ADR-006 ("Author Yourself") and the house-style notes:
// authoritative, peer-to-peer, ~0 exclamations, no mascot. Mentible is NOT a
// chatbot — the words are verbs of authorship and publishing, never
// "prompt / chat / generate with AI".

export const NAV = {
  library: "Library",
  // The authoring home (route is still `books`); "Studio" pairs with Library
  // and removes the old Books/Library ambiguity (both read as "shelves").
  studio: "Studio",
  shelves: "Shelves",
  settings: "Settings",
  help: "Help",
  about: "About",
} as const;

// The scoped-authoring flow (internally: structure → generate → export).
export const FLOW = {
  outline: "Outline",
  write: "Write",
  publish: "Publish",
} as const;

// Job states — surfaced with the sprout→leaf growth motif. Copy is age-neutral
// and never exposes codes or stack traces (Content Rule #5).
export const JOB_STATE = {
  queued: "Queued",
  writing: "Writing…",
  ready: "Ready",
  failed: "Couldn’t finish — try again",
} as const;
