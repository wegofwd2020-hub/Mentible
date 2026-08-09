import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView, StructuredTocView } from "@/api/trustClient";
import type { Book, SubjectNode, TopicNode, GeneratedTopic } from "@/types/book";
import type { LessonOutput, LessonSection } from "@/types/lesson";

function makeLesson(title: string, secs: DraftSection[]): LessonOutput {
  const sections: LessonSection[] = secs.map((s) => ({ heading: s.heading, body_markdown: s.body }));
  return {
    topic: title,
    level: "",
    language: "en",
    synopsis: "",
    learning_objectives: [],
    sections,
    key_takeaways: [],
    further_reading: [],
  };
}

// Assembles validated per-topic drafts (Slice C) into one multi-topic Book —
// the deliverable consumed unchanged by the existing EPUB3/PDF export
// pipeline. Parallel to artifactToBook (single-topic), but walks the whole
// StructuredTocView and aggregates Sources across every topic.
export function topicsToBook(
  projectTitle: string,
  toc: StructuredTocView,
  topicSections: Map<string, DraftSection[]>,
  inputs: ProjectInputView[],
): Book {
  const now = new Date().toISOString();
  const safeTitle = projectTitle.trim() || "Untitled";

  const subjects: SubjectNode[] = [];
  const content: Record<string, GeneratedTopic> = {};
  const allSections: DraftSection[] = [];

  for (const subject of toc.subjects) {
    const units: TopicNode[] = [];
    for (const unit of subject.units) {
      units.push({ id: unit.id, title: unit.title, subtopics: [], prerequisites: [] });
      const secs = topicSections.get(unit.id) ?? [];
      allSections.push(...secs);
      content[unit.id] = {
        topicId: unit.id,
        title: unit.title,
        lesson: makeLesson(unit.title, secs),
        generatedAt: now,
      };
    }
    subjects.push({ subject_label: subject.subject_label, units });
  }

  const labelFor = new Map(inputs.map((inp, i) => [inp.id, `S${i + 1}`] as const));
  const byId = new Map(inputs.map((inp) => [inp.id, inp] as const));
  const cited = [...new Set(allSections.flatMap((s) => s.source_ids ?? []))];
  if (cited.length) {
    const lines = cited.map((id) => {
      const inp = byId.get(id);
      const name = inp ? inp.title || inp.source_ref || inp.content.slice(0, 80) : "(source)";
      return `- [${labelFor.get(id) ?? "cited"}] ${name}`;
    });
    const sourcesId = randomUUID();
    subjects.push({
      subject_label: "Sources",
      units: [{ id: sourcesId, title: "Sources", subtopics: [], prerequisites: [] }],
    });
    content[sourcesId] = {
      topicId: sourcesId,
      title: "Sources",
      lesson: makeLesson("Sources", [{ heading: "Sources", body: lines.join("\n"), source_ids: [] }]),
      generatedAt: now,
    };
  }

  return {
    id: randomUUID(),
    title: safeTitle,
    toc: { subjects },
    content,
    createdAt: now,
    updatedAt: now,
  };
}
