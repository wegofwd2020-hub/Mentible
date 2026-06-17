import { type Subtopic, subtopicLabel, subtopicDetail } from "@/types/book";

// Backend `topic` field cap (generate/schemas.py) — fold only short labels in.
const TOPIC_MAX = 500;
// Backend `instructions` field cap (generate/schemas.py).
const INSTRUCTIONS_MAX = 2000;

// A book topic carries its subtopics as scope; fold their short LABELS into the
// topic line so the generated lesson stays on-topic within the book without
// overflowing the 500-char topic field. The detailed scope text travels
// separately via buildTopicInstructions. Shared by the batch generate-all loop
// and the single-topic regenerate path so both produce the same prompt.
export function buildTopicPrompt(title: string, subtopics: Subtopic[]): string {
  if (subtopics.length === 0) return title;
  const folded = `${title} — covering: ${subtopics.map(subtopicLabel).join(", ")}`;
  return folded.length > TOPIC_MAX ? folded.slice(0, TOPIC_MAX) : folded;
}

// The long per-subtopic detail is the real generation guidance; carry it (plus
// any author enhancement) in the roomier `instructions` field so the short
// labels in the topic line don't lose specificity. Returns undefined when there
// is nothing to add. Truncated to the backend's instructions cap.
export function buildTopicInstructions(
  subtopics: Subtopic[],
  enhancement?: string,
): string | undefined {
  const details = subtopics
    .map((s) => ({ label: subtopicLabel(s), detail: subtopicDetail(s)?.trim() }))
    .filter((s) => s.detail)
    .map((s) => `- ${s.label}: ${s.detail}`);

  const parts: string[] = [];
  if (details.length) parts.push(`Make sure to cover these subtopics:\n${details.join("\n")}`);
  const extra = enhancement?.trim();
  if (extra) parts.push(extra);
  if (parts.length === 0) return undefined;

  const combined = parts.join("\n\n");
  return combined.length > INSTRUCTIONS_MAX ? combined.slice(0, INSTRUCTIONS_MAX) : combined;
}
