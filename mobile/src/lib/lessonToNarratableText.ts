import type { LessonOutput } from "@/types/lesson";

// Flatten a topic's lesson into plain narratable text for /derivatives/audio's
// source_text. The backend generate_narration rewrites this into speakable
// prose, so this only needs the topic's substance (not polished markup) —
// synopsis, each section body, then the key takeaways. Book authoring has no
// topic_version_id (that's the trust surface), so this is how a book topic
// becomes a narration source.
export function lessonToNarratableText(lesson: LessonOutput): string {
  const parts: string[] = [];
  if (lesson?.synopsis) parts.push(lesson.synopsis);
  for (const s of lesson?.sections ?? []) {
    if (s?.body_markdown) parts.push(s.body_markdown);
  }
  for (const k of lesson?.key_takeaways ?? []) {
    if (k) parts.push(k);
  }
  return parts.join("\n\n").trim();
}
