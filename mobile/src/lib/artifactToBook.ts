import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView } from "@/api/trustClient";
import type { Book, BookMetadata } from "@/types/book";
import type { LessonSection } from "@/types/lesson";

export function artifactToBook(
  sections: DraftSection[],
  title: string,
  inputs: ProjectInputView[],
  metadata?: BookMetadata,
): Book {
  const now = new Date().toISOString();
  const topicId = randomUUID();
  const safeTitle = title.trim() || "Untitled";

  const lessonSections: LessonSection[] = sections.map((s) => ({
    heading: s.heading,
    body_markdown: s.body,
    source_ids: s.source_ids,
  }));

  const labelFor = new Map(inputs.map((inp, i) => [inp.id, `S${i + 1}`] as const));
  const byId = new Map(inputs.map((inp) => [inp.id, inp] as const));
  const cited = [...new Set(sections.flatMap((s) => s.source_ids ?? []))];
  if (cited.length) {
    const lines = cited.map((id) => {
      const inp = byId.get(id);
      const name = inp ? inp.title || inp.source_ref || inp.content.slice(0, 80) : "(source)";
      return `- [${labelFor.get(id) ?? "cited"}] ${name}`;
    });
    lessonSections.push({ heading: "Sources", body_markdown: lines.join("\n") });
  }

  const lesson = {
    topic: safeTitle,
    level: "",
    language: "en",
    synopsis: "",
    learning_objectives: [],
    sections: lessonSections,
    key_takeaways: [],
    further_reading: [],
  };

  return {
    id: randomUUID(),
    title: safeTitle,
    toc: {
      subjects: [
        { subject_label: safeTitle, units: [{ id: topicId, title: safeTitle, subtopics: [], prerequisites: [] }] },
      ],
    },
    content: { [topicId]: { topicId, title: safeTitle, lesson, generatedAt: now } },
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}
