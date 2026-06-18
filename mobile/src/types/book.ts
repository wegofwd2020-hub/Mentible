// Book-authoring types — mirror the backend StructuredTOC shape
// (pipeline/toc_structurer.py) and the POST /structure request/response.

import type { LessonOutput, Provenance } from "@/types/lesson";
import type { GenerationParams } from "@/types/generationParams";
import type { TrustManifest } from "@/types/trust";

// A subtopic is either a bare label (legacy books / structurer output) or a
// { label, detail } pair. `label` is a short 3–5 word heading shown in the
// authoring outline and folded into the generation topic; `detail` is the long
// descriptive scope text — fed to generation as guidance. Keeping the union
// means every book ever saved still loads unchanged; use the helpers below
// instead of branching on the type inline.
export type Subtopic = string | { label: string; detail?: string };

export function subtopicLabel(s: Subtopic): string {
  return typeof s === "string" ? s : s.label;
}

export function subtopicDetail(s: Subtopic): string | undefined {
  return typeof s === "string" ? undefined : s.detail;
}

export interface TopicNode {
  // Client-assigned stable id (kept across edits/reorders so generated content
  // can be keyed to a topic). Not part of the backend StructuredTOC contract —
  // /structure neither sends nor returns it. Optional for back-compat with
  // books saved before generate-all existed; backfilled on load.
  id?: string;
  title: string;
  subtopics: Subtopic[];
  prerequisites: string[];
  // Free-text author guidance re-applied on every (re)generation of this topic
  // (e.g. "add a diagram for the T-shape"). Persisted so refinements stick.
  enhancementInstructions?: string;
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
  // Which provider/model + versions produced this content (when known). Absent
  // on pre-Phase-3c units and on imported books.
  provenance?: Provenance;
  // Content Trust Manifest (ADR-015) persisted by the backend once SBQ-TRUST-001's
  // worker wiring lands. Until then it's absent and the badge is built from
  // `provenance` + `generatedAt` (ADR-016 D7 — no new generation data required).
  trust?: TrustManifest;
  // Monotonic regeneration count for this unit (ADR-016 D7 content version).
  // Bumped by setTopicContent on every overwrite; absent/0 = original generation.
  revisionCount?: number;
}

// Conventional bibliographic metadata → EPUB OPF (dc:*) + colophon page on
// compile. All optional; kept aligned with compiler/src/types.ts BookMetadata.
export interface BookMetadata {
  author?: string;
  authorFileAs?: string;
  publisher?: string;
  language?: string; // dc:language + package xml:lang (default "en")
  description?: string;
  // Inline vector cover for the in-app shelf (BookCover). Kept React-Native-SVG
  // safe (inline attributes only — no <style>/CSS/gradients) so it renders on
  // native as well as web. Distinct from the compiler's EPUB/PDF cover.
  coverSvg?: string;
  subjects?: string[];
  rights?: string;
  date?: string;
  identifier?: string; // ISBN/UUID; defaults to book id
  series?: string;
  seriesIndex?: number;
  accessibility?: BookAccessibility; // EPUB Accessibility 1.1 (schema.org a11y) metadata

  // Release lifecycle (ADR-008). Absent or "release" → no watermark. These drive
  // the cover's edition stamp (editionLabel) and the colophon — kept aligned with
  // compiler/src/types.ts BookMetadata.
  status?: "draft" | "release"; // "draft" watermarks the artifact
  version?: string; // e.g. "1.0"
  edition?: string; // e.g. "First Edition"
  releaseDate?: string; // ISO date, set on release
  watermark?: string; // explicit override text; else "DRAFT" when status === "draft"
  revisionHistory?: { version: string; date: string; notes?: string }[];
}

// EPUB Accessibility 1.1 metadata (schema.org a11y vocabulary). Auto-derived
// from content on compile; these fields override/extend. Kept aligned with
// compiler/src/types.ts BookAccessibility. We do not auto-claim WCAG conformance
// or alt text — conformsTo/certifiedBy are for audited titles. See
// docs/PROFESSIONAL_PUBLISHING.md.
export interface BookAccessibility {
  summary?: string; // schema:accessibilitySummary
  accessModes?: string[]; // schema:accessMode (replaces auto set)
  accessModeSufficient?: string[]; // schema:accessModeSufficient (each entry a comma-joined set)
  features?: string[]; // schema:accessibilityFeature (merged with auto)
  hazards?: string[]; // schema:accessibilityHazard (default ["none"])
  conformsTo?: string; // dcterms:conformsTo URL — only when conformant
  certifiedBy?: string; // a11y:certifiedBy
}

// Provenance of a stored book. "bundled" = seeded read-only from the default
// shareable library (ADR-017); absent/"user" = authored or imported by the user.
// Editing a bundled book forks a user-owned copy (copy-on-write, ADR-017 D3), and
// bundled books are excluded from the D18 fair-use cap once that cap exists.
export type BookSource = "bundled" | "user";

// A book persisted on the device (local-first, per ADR-003 D1).
export interface Book {
  id: string;
  title: string;
  toc: StructuredTOC;
  createdAt: string;
  updatedAt: string;
  // Where this book came from. Absent ⇒ user-authored/imported (treated as
  // "user"). "bundled" marks a seeded default-library book (ADR-017).
  source?: BookSource;
  // Per-topic generated content, keyed by TopicNode.id. Absent until the user
  // runs "generate all". Orphaned entries (topic removed) are pruned on save.
  content?: Record<string, GeneratedTopic>;
  // The book's generation template (level / depth / pages …) — the single
  // source of truth for generating any topic in this book. Seeded from the
  // global default (settingsStore) at creation; defaulted on load if missing.
  generationParams?: GenerationParams;
  // Bibliographic metadata for the compiled artifact (author, publisher, …).
  metadata?: BookMetadata;
}

// Lightweight index entry for the books list (no full TOC).
export interface BookMeta {
  id: string;
  title: string;
  subjectCount: number;
  unitCount: number;
  updatedAt: string;
  // Number of topics with generated content (for the books-list progress
  // readout). Absent on books saved before this field existed.
  generatedCount?: number;
  // Mirrors Book.source so the books list can badge/guard bundled books
  // without loading each full book (ADR-017).
  source?: BookSource;
  // Inline vector cover (BookMetadata.coverSvg), surfaced in the index so the
  // shelf can render a real cover without loading each full book.
  coverSvg?: string;
}
