import type { TopicVersionDetailView, VersionDetailView } from "@/api/trustClient";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput, LessonSection } from "@/types/lesson";

// A per-topic draft version → the same GeneratedTopic lesson shape
// topicsToBook.ts (makeLesson) / artifactToBook.ts build, so the trust topic
// viewer can render through the SAME reader pipeline (TopicRenderer →
// NativeTopicReader on web / the WebView doc on native) that the Studio topic
// screen and the compiled artifact use — not a second, hand-rolled renderer.
// Pure: no I/O, no randomUUID, so it's trivial to unit-test.
function sectionsToTopic(
  id: string,
  title: string,
  sections: { heading: string; body: string }[],
  createdAt: string,
): GeneratedTopic {
  const lessonSections: LessonSection[] = sections.map((s) => ({
    heading: s.heading,
    body_markdown: s.body,
  }));
  const lesson: LessonOutput = {
    topic: title,
    level: "",
    language: "en",
    synopsis: "",
    learning_objectives: [],
    sections: lessonSections,
    key_takeaways: [],
    further_reading: [],
  };
  return {
    topicId: id,
    title,
    lesson,
    generatedAt: createdAt,
  };
}

export function topicVersionToTopic(tv: TopicVersionDetailView): GeneratedTopic {
  return sectionsToTopic(tv.id, tv.title, tv.content.sections, tv.created_at ?? "");
}

// A whole-book draft version (no per-topic `title` field) → the same
// GeneratedTopic shape, so the book-draft render preview can share the same
// reader pipeline as the per-topic viewer above.
export function versionToTopic(v: VersionDetailView): GeneratedTopic {
  return sectionsToTopic(v.id, "", v.content.sections, v.created_at ?? "");
}
