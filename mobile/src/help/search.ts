import type { HelpBlock, HelpTopic } from "./schema";

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

// Case-insensitive search over title + keywords + visible text. Empty query
// returns all topics. No default `topics` — the engine holds no content.
export function searchHelpTopics(query: string, topics: HelpTopic[]): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  return topics.filter((t) =>
    `${t.title} ${t.keywords.join(" ")} ${blockText(t.blocks)}`.toLowerCase().includes(q),
  );
}
