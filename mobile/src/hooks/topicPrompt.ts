// A book topic carries its subtopics as scope; fold them into the prompt so the
// generated lesson stays on-topic within the book. Shared by the batch
// generate-all loop and the single-topic regenerate path so both produce the
// same prompt for the same topic.
export function buildTopicPrompt(title: string, subtopics: string[]): string {
  if (subtopics.length === 0) return title;
  return `${title} — covering: ${subtopics.join(", ")}`;
}
