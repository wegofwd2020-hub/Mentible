// Book-authoring types — mirror the backend StructuredTOC shape
// (pipeline/toc_structurer.py) and the POST /structure request/response.

import type { LessonOutput } from "@/types/lesson";

export interface TopicNode {
  // Client-assigned stable id (kept across edits/reorders so generated content
  // can be keyed to a topic). Not part of the backend StructuredTOC contract —
  // /structure neither sends nor returns it. Optional for back-compat with
  // books saved before generate-all existed; backfilled on load.
  id?: string;
  title: string;
  subtopics: string[];
  prerequisites: string[];
}

export interface SubjectNode {
  subject_label: string;
  units: TopicNode[];
}

export interface StructuredTOC {
  subjects: SubjectNode[];
}

export interface StructureRequest {
  request_id: string;
  raw_toc: string;
  grade?: number;
  api_key: string;
  model?: string;
}

export interface StructureResponse {
  job_id: string;
  status: "queued";
}

// The /structure job result polled from the shared /jobs/{id} endpoint.
export type StructureJobStatus = "queued" | "running" | "done" | "failed";

export interface StructureJobResponse {
  job_id: string;
  status: StructureJobStatus;
  result?: StructuredTOC;
  error?: string;
}

// One topic's generated lesson, produced by the generate-all loop.
export interface GeneratedTopic {
  topicId: string;
  title: string; // snapshot of the topic title at generation time
  lesson: LessonOutput;
  generatedAt: string;
}

// A book persisted on the device (local-first, per ADR-003 D1).
export interface Book {
  id: string;
  title: string;
  toc: StructuredTOC;
  createdAt: string;
  updatedAt: string;
  // Per-topic generated content, keyed by TopicNode.id. Absent until the user
  // runs "generate all". Orphaned entries (topic removed) are pruned on save.
  content?: Record<string, GeneratedTopic>;
}

// Lightweight index entry for the books list (no full TOC).
export interface BookMeta {
  id: string;
  title: string;
  subjectCount: number;
  unitCount: number;
  updatedAt: string;
}
