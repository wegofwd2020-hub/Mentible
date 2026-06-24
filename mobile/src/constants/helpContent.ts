// Structured, searchable help content (issue #60). Rendered by
// app/(tabs)/help.tsx. Keeping help as data — not hard-coded JSX — makes it
// maintainable, searchable, and deep-linkable by topic id. Add a topic by
// appending to HELP_TOPICS; the screen renders + indexes it automatically.

import { PROVIDERS } from "@/constants/providers";
import { COST_LABEL, PROVIDER_GUIDES } from "@/constants/providerGuides";
import type { StepId } from "@/onboarding/firstRunState";

// Internal routes a help link may point at (kept a union so it satisfies
// expo-router's typed routes without a cast).
export type HelpHref = "/settings" | "/diagram-types" | "/sign-in";

export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: string[] }
  | { kind: "link"; label: string; href: HelpHref }
  | { kind: "defs"; defs: { term: string; def: string }[] }
  // Re-launch a first-run wizard step (the Help screen calls relaunchStep(step)).
  | { kind: "action"; label: string; step: StepId };

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
        case "action":
          return b.label;
      }
    })
    .join(" ");
}

// One "where to get a key" line per provider, derived from the provider guides
// so the help page can't drift from the in-wizard guidance.
function providerKeyDefs(): { term: string; def: string }[] {
  return PROVIDERS.flatMap((p) => {
    const g = PROVIDER_GUIDES[p.id];
    if (!g) return [];
    return [
      {
        term: p.label,
        def: `${COST_LABEL[g.cost]}. Get a key at ${g.consoleLabel} (key looks like ${p.keyHint}).`,
      },
    ];
  });
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
    id: "getting-started-account",
    title: "Create your account & sign in",
    keywords: [
      "account", "sign in", "signin", "sign up", "signup", "login", "log in",
      "register", "google", "email", "password", "confirm", "verify", "sync",
    ],
    blocks: [
      {
        kind: "text",
        text: "An account is optional but recommended: it syncs your library and provider settings across your devices. You can sign up with an email and password, or continue with Google. You can always read the included books and use a BYOK key without an account.",
      },
      {
        kind: "steps",
        steps: [
          "Open the sign-in screen (or the first-run wizard) and choose Create account.",
          "Enter your email and a password (at least 6 characters), or tap Continue with Google.",
          "If you signed up with email, check your inbox and tap the confirmation link, then sign in.",
          "Once signed in, your library and provider settings sync automatically.",
        ],
      },
      { kind: "action", label: "Start the sign-up walkthrough", step: "signup" },
      {
        kind: "defs",
        defs: [
          {
            term: "Didn't get the confirmation email",
            def: "Check your spam folder and that the address is correct. Re-running sign-up resends the link.",
          },
          {
            term: "“Continue with Google” did nothing",
            def: "The sign-in browser was likely dismissed. Tap Continue with Google again and complete the Google prompt.",
          },
          {
            term: "Sign-in isn't available",
            def: "Some builds (including the demo) run without accounts — you can still read the included books and use a BYOK key without signing in.",
          },
        ],
      },
      { kind: "link", label: "Open sign-in →", href: "/sign-in" },
    ],
  },
  {
    id: "provider-keys",
    title: "Choose a provider & get an API key",
    keywords: [
      "key", "api", "byok", "provider", "anthropic", "claude", "openai", "groq",
      "openrouter", "gemini", "google", "free", "paid", "billing", "cost",
    ],
    blocks: [
      {
        kind: "text",
        text: "Mentible is bring-your-own-key (BYOK): you connect your own LLM account and are billed by that provider directly. Your key is stored in the device keystore and sent per request — never logged or stored on a server. You can add more than one provider and switch between them in Settings.",
      },
      {
        kind: "text",
        text: "Want to try it free? Groq, Google Gemini and OpenRouter all have free tiers (output is draft-grade). Anthropic (Claude) gives the best quality for finished books but is paid.",
      },
      { kind: "defs", defs: providerKeyDefs() },
      {
        kind: "steps",
        steps: [
          "In Settings (or the first-run wizard), pick a provider.",
          "Open that provider's console using the link and create an API key.",
          "Copy the key and paste it into the key field — it's checked for the right shape and saved on your device.",
          "Your key is verified the first time you generate; if it's wrong you'll see a clear error.",
        ],
      },
      { kind: "action", label: "Start the API-key walkthrough", step: "key" },
      { kind: "link", label: "Open Settings →", href: "/settings" },
    ],
  },
  {
    id: "reading-a-book",
    title: "Open a book & get around",
    keywords: [
      "read", "reading", "open", "book", "library", "tabs", "navigate", "menu",
      "topic", "lesson", "export", "epub", "pdf", "tour", "studio", "shelf",
    ],
    blocks: [
      {
        kind: "text",
        text: "Mentible has five places along the top of the app: Library (your finished books), Studio (create and edit books), Settings (your LLM keys and preferences), Help (guides and these walkthroughs), and About (version and privacy).",
      },
      {
        kind: "steps",
        steps: [
          "Open Library and tap a book cover to open it.",
          "Inside the book, tap a topic to read its lesson.",
          "Use Export to save the book as an EPUB or PDF for offline reading.",
        ],
      },
      {
        kind: "text",
        text: "New here? Your Library already has a book ready to open, so you can start reading before authoring anything of your own.",
      },
      { kind: "action", label: "Replay the app tour", step: "tour" },
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
