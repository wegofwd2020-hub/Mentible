// Structured, searchable help content (issue #60). Rendered by
// app/(tabs)/help.tsx. Keeping help as data — not hard-coded JSX — makes it
// maintainable, searchable, and deep-linkable by topic id. Add a topic by
// appending to HELP_TOPICS; the screen renders + indexes it automatically.

// Internal routes a help link may point at (kept a union so it satisfies
// expo-router's typed routes without a cast).
export type HelpHref = "/settings" | "/diagram-types";

export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: string[] }
  | { kind: "link"; label: string; href: HelpHref }
  | { kind: "defs"; defs: { term: string; def: string }[] };

export interface HelpTopic {
  id: string; // stable id (future deep-link target)
  title: string;
  keywords: string[]; // extra search terms beyond the visible text
  blocks: HelpBlock[];
}

// Flatten a topic's visible text for indexing/search.
export function blockText(blocks: HelpBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "text":
          return b.text;
        case "steps":
          return b.steps.join(" ");
        case "link":
          return b.label;
        case "defs":
          return b.defs.map((d) => `${d.term} ${d.def}`).join(" ");
      }
    })
    .join(" ");
}

// Case-insensitive search over title + keywords + visible text. Empty query
// returns all topics (so the Help screen shows everything by default).
export function searchHelpTopics(query: string, topics: HelpTopic[] = HELP_TOPICS): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  return topics.filter((t) =>
    `${t.title} ${t.keywords.join(" ")} ${blockText(t.blocks)}`.toLowerCase().includes(q),
  );
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    keywords: ["start", "begin", "first", "setup", "onboard"],
    blocks: [
      {
        kind: "steps",
        steps: [
          "Add your Anthropic API key in Settings (stored only on your device).",
          "In Books, start a new book or import one, then structure its table of contents.",
          "Generate — each topic is written with math, diagrams and tables, scoped by level, depth and diagram register.",
          "Save the finished book to your Library as an EPUB you can read or export.",
        ],
      },
    ],
  },
  {
    id: "byok",
    title: "Your Anthropic key (BYOK)",
    keywords: ["key", "api", "byok", "anthropic", "billing", "pay", "secure", "privacy"],
    blocks: [
      {
        kind: "text",
        text: "Mentible is bring-your-own-key: you pay Anthropic directly. Your key is kept in the device keystore and sent per request to generate content — it is never logged or stored on a server.",
      },
      { kind: "link", label: "Open Settings →", href: "/settings" },
    ],
  },
  {
    id: "scoped-generation",
    title: "How scoping works",
    keywords: ["scope", "scoped", "level", "depth", "length", "parameters", "chatbot"],
    blocks: [
      {
        kind: "text",
        text: "Mentible isn't a chatbot. Every topic is generated with a scoped request tuned by a few dimensions — level, depth, length and diagram register — a real lesson inside your book, not a chat reply. Adjust the scope to change the reading level, how deep it goes, and the kind of diagrams it produces.",
      },
    ],
  },
  {
    id: "diagram-types",
    title: "Diagram types",
    keywords: ["diagram", "visual", "register", "conceptual", "balanced", "technical", "mindmap", "flowchart"],
    blocks: [
      {
        kind: "text",
        text: "The Diagrams setting controls what kind of visuals you get — from big-idea infographics to precise technical diagrams. Browse examples to pick the direction that fits your audience.",
      },
      { kind: "link", label: "Browse diagram types →", href: "/diagram-types" },
    ],
  },
  {
    id: "formats",
    title: "Formats & books",
    keywords: ["format", "epub", "pdf", "book", "compile", "library", "export", "cover"],
    blocks: [
      {
        kind: "text",
        text: "Each topic is generated as a lesson and compiled into an EPUB/PDF book with a branded cover, figures, tables and a glossary, shown on your Library shelf.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    keywords: ["error", "fail", "failed", "problem", "timeout", "offline", "broken", "fix", "faq"],
    blocks: [
      {
        kind: "defs",
        defs: [
          {
            term: "“No API key set”",
            def: "Open Settings and paste your Anthropic key (starts with sk-ant-). It is stored only on your device.",
          },
          {
            term: "Generation failed or timed out",
            def: "Check your connection and that your key is valid and has credit, then try again. Large page targets take longer.",
          },
          {
            term: "Key rejected",
            def: "Re-check the key in Settings — it must be an Anthropic key beginning with sk-ant-. Re-enter it if you recently rotated it.",
          },
          {
            term: "Nothing happens offline",
            def: "Generation needs a connection (it calls Anthropic). Books already saved to your Library open offline.",
          },
        ],
      },
    ],
  },
  {
    id: "glossary",
    title: "Glossary",
    keywords: ["glossary", "term", "definition", "meaning", "katex", "mermaid"],
    blocks: [
      {
        kind: "defs",
        defs: [
          { term: "BYOK", def: "Bring Your Own Key — you supply your Anthropic API key and are billed by Anthropic directly." },
          { term: "Scoped generation", def: "A generation request parametrised by level, depth, length, language and diagram register — the core model of the app." },
          { term: "Diagram register", def: "The chosen direction of a book's visuals: Conceptual, Balanced, or Technical." },
          { term: "EPUB3 / PDF", def: "The compiled book formats Mentible produces, with a cover, figures, tables and a glossary." },
          { term: "KaTeX", def: "The math typesetting used to render formulas in lessons." },
          { term: "Mermaid", def: "The text-to-diagram syntax used to render flowcharts and other technical diagrams." },
        ],
      },
    ],
  },
];
