import type { TopicVersionDetailView } from "@/api/trustClient";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput, LessonSection } from "@/types/lesson";

// A per-topic draft version → the same GeneratedTopic lesson shape
// topicsToBook.ts (makeLesson) / artifactToBook.ts build, so the trust topic
// viewer can render through the SAME reader pipeline (TopicRenderer →
// NativeTopicReader on web / the WebView doc on native) that the Studio topic
// screen and the compiled artifact use — not a second, hand-rolled renderer.
// Pure: no I/O, no randomUUID, so it's trivial to unit-test.
export function topicVersionToTopic(tv: TopicVersionDetailView): GeneratedTopic {
  const sections: LessonSection[] = tv.content.sections.map((s) => ({
    heading: s.heading,
    body_markdown: s.body,
  }));
  const lesson: LessonOutput = {
    topic: tv.title,
    level: "",
    language: "en",
    synopsis: "",
    learning_objectives: [],
    sections,
    key_takeaways: [],
    further_reading: [],
  };
  return {
    topicId: tv.id,
    title: tv.title,
    lesson,
    generatedAt: tv.created_at ?? "",
  };
}
