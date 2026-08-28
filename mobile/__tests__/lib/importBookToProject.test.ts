// Self-serve Studio-book → Project import: maps a book's TOC to a project TOC and
// each topic's lesson to a manual (no-LLM) topic version. Outline-only topics skip.
jest.mock("@/api/trustClient", () => ({
  createProject: jest.fn(async () => ({ id: "proj-1" })),
  saveToc: jest.fn(async () => undefined),
  createTopicVersion: jest.fn(async () => ({ id: "tv-1" })),
}));

import { createProject, createTopicVersion, saveToc } from "@/api/trustClient";
import { importBookToProject } from "@/lib/importBookToProject";
import type { Book } from "@/types/book";

const BOOK = {
  id: "b1",
  title: "  Tholkapiam  ",
  toc: {
    subjects: [
      {
        subject_label: "Grammar",
        units: [
          { id: "t1", title: "Sounds", subtopics: [], prerequisites: [] },
          { id: "t2", title: "Words (outline only)", subtopics: [], prerequisites: [] },
          { title: "No id — skipped", subtopics: [], prerequisites: [] },
        ],
      },
    ],
  },
  content: {
    t1: {
      topicId: "t1",
      title: "Sounds",
      generatedAt: "2026-08-01T00:00:00Z",
      lesson: {
        topic: "Sounds",
        sections: [{ heading: "Vowels", body_markdown: "a e i o u", source_ids: [] }],
      },
    },
    // t2 has no content → skipped
  },
} as unknown as Book;

beforeEach(() => jest.clearAllMocks());

it("creates a project, saves the TOC, and imports only topics that have content", async () => {
  const res = await importBookToProject(BOOK, "tok");

  expect(createProject).toHaveBeenCalledWith({ title: "Tholkapiam" }, "tok"); // trimmed
  // TOC saved with the two id-bearing units (the id-less one is dropped)
  const [, toc] = (saveToc as jest.Mock).mock.calls[0];
  expect(toc.subjects[0].units.map((u: { id: string }) => u.id)).toEqual(["t1", "t2"]);

  // only t1 (has a lesson) becomes a manual version; sections map body_markdown→body
  expect(createTopicVersion).toHaveBeenCalledTimes(1);
  expect(createTopicVersion).toHaveBeenCalledWith(
    "proj-1",
    "t1",
    { sections: [{ heading: "Vowels", body: "a e i o u", source_ids: [] }] },
    "tok",
  );

  expect(res).toEqual({ projectId: "proj-1", topicsImported: 1, topicsSkipped: 1 });
});
