// Self-serve one-time migration: convert a device-local Studio book into a trust
// Project (ADR-037). Runs entirely on the user's device against the existing trust
// API — no backend change. A book already IS a TOC (subjects → units) with per-topic
// lessons, and a Project is the same shape, so each topic's lesson becomes a manual
// topic-version (no LLM call, no cost).
//
// Non-destructive: the Studio book is untouched. The imported drafts are UNVALIDATED
// and UNGROUNDED (Studio books carry no sources/citations) — the user adds sources
// and approves afterwards to make them real, validated Project content.

import type { Book } from "@/types/book";
import {
  createProject,
  createTopicVersion,
  saveToc,
  type StructuredTocView,
} from "@/api/trustClient";

export interface ImportResult {
  projectId: string;
  topicsImported: number; // topics that had content and became a draft version
  topicsSkipped: number; // outline-only topics (no generated lesson yet)
}

// Book.toc is structurally a StructuredTocView already; normalize so every unit
// carries the arrays the trust TOC requires (defends against older stored books).
function tocFromBook(book: Book): StructuredTocView {
  const subjects = (book.toc?.subjects ?? []).map((s) => ({
    subject_label: s.subject_label,
    // Only units with a stable id can become trust topics (topics are keyed by id).
    units: (s.units ?? [])
      .filter((u): u is typeof u & { id: string } => typeof u.id === "string" && u.id.length > 0)
      .map((u) => ({
        id: u.id,
        title: u.title,
        subtopics: u.subtopics ?? [],
        prerequisites: u.prerequisites ?? [],
      })),
  }));
  return { subjects };
}

export async function importBookToProject(book: Book, token: string): Promise<ImportResult> {
  const toc = tocFromBook(book);
  const project = await createProject({ title: book.title?.trim() || "Untitled" }, token);
  await saveToc(project.id, toc, token);

  let topicsImported = 0;
  let topicsSkipped = 0;
  for (const subject of toc.subjects) {
    for (const unit of subject.units) {
      const sections = book.content?.[unit.id]?.lesson?.sections;
      if (!sections || sections.length === 0) {
        topicsSkipped++;
        continue;
      }
      const content = {
        sections: sections.map((s) => ({
          heading: s.heading,
          body: s.body_markdown, // trust sections use `body`; lesson uses `body_markdown`
          source_ids: s.source_ids ?? [],
        })),
      };
      await createTopicVersion(project.id, unit.id, content, token);
      topicsImported++;
    }
  }

  return { projectId: project.id, topicsImported, topicsSkipped };
}
