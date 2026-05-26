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

// Extra content types beyond the lesson. These mirror exactly the shapes
// emitted by the OnDemand book-export contract (StudyBuddy_OnDemand
// `backend/src/admin/book_export.py`), so a migrated book.json drops straight in.
// Field names are snake_case to match the vendored pipeline schema (like
// LessonOutput). They are optional on GeneratedTopic: native single-lesson
// generation produces only `lesson`; a migrated book may carry all five.

export interface TutorialSection {
  section_id: string;
  title: string;
  content: string; // markdown
  examples: string[]; // markdown each
  practice_question: string;
}

export interface TutorialOutput {
  title: string;
  sections: TutorialSection[];
  common_mistakes: string[];
}

export interface QuizOption {
  option_id: string; // "A" | "B" | "C" | "D"
  text: string;
}

export interface QuizQuestion {
  question_id: string;
  question_text: string; // markdown (may contain GFM tables / KaTeX)
  question_type: string; // "multiple_choice"
  options: QuizOption[];
  correct_option: string; // "A" | "B" | "C" | "D"
  explanation: string; // markdown
  difficulty: string; // "easy" | "medium" | "hard"
}

export interface QuizSet {
  set_number: number | null;
  questions: QuizQuestion[];
  total_questions: number | null;
  passing_score: number | null;
  estimated_duration_minutes: number | null;
}

export interface ExperimentStep {
  step_number: number | null;
  instruction: string;
  expected_observation: string;
}

export interface ExperimentQuestion {
  question: string;
  answer: string;
}

export interface ExperimentOutput {
  experiment_title: string;
  materials: string[];
  safety_notes: string[];
  steps: ExperimentStep[];
  questions: ExperimentQuestion[];
  conclusion_prompt: string;
}

// One topic's generated content, produced by the generate-all loop (lesson
// only) or imported from a migrated book (lesson + any of the extras).
export interface GeneratedTopic {
  topicId: string;
  title: string; // snapshot of the topic title at generation time
  lesson: LessonOutput;
  tutorial?: TutorialOutput;
  quizSets?: QuizSet[];
  experiment?: ExperimentOutput;
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
