// The content contract the compiler consumes — the canonical book.json shape.
// MUST stay aligned with mobile/src/types/book.ts + mobile/src/types/lesson.ts
// (the authoring app produces this; the compiler renders it). See
// docs/COMPILE_PIPELINE_PLAN.md "Types contract".

export interface LessonSection {
  heading: string;
  body_markdown: string;
}

export interface LessonOutput {
  topic: string;
  level: string;
  language: string;
  synopsis: string;
  learning_objectives: string[];
  sections: LessonSection[];
  key_takeaways: string[];
  further_reading: string[];
}

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
  question_type: string;
  options: QuizOption[];
  correct_option: string; // "A" | "B" | "C" | "D"
  explanation: string; // markdown
  difficulty: string;
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

// One topic's generated content. Native generation produces only `lesson`; a
// migrated/authored book may carry all five.
export interface GeneratedTopic {
  topicId: string;
  title: string;
  lesson: LessonOutput;
  tutorial?: TutorialOutput;
  quizSets?: QuizSet[];
  experiment?: ExperimentOutput;
  generatedAt: string;
}

// Mirrors mobile/src/types/book.ts: a subtopic is a bare label (legacy) or a
// { label, detail } pair. The compiler does not render subtopics, but the type
// must accept both shapes so a relabeled book.json type-checks here too.
export type Subtopic = string | { label: string; detail?: string };

export interface TopicNode {
  id?: string;
  title: string;
  subtopics: Subtopic[];
  prerequisites: string[];
}


export interface SubjectNode {
  subject_label: string;
  units: TopicNode[];
}

export interface StructuredTOC {
  subjects: SubjectNode[];
}

// Conventional bibliographic metadata → EPUB OPF (dc:*) + colophon page.
// All optional; absent fields are simply omitted from the OPF.
export interface BookMetadata {
  author?: string; // dc:creator
  authorFileAs?: string; // creator file-as (sort name, e.g. "Doe, Jane")
  publisher?: string; // dc:publisher
  language?: string; // dc:language + package xml:lang (default "en")
  description?: string; // dc:description
  coverSvg?: string; // in-app shelf cover (mobile BookCover); compiler ignores it
  subjects?: string[]; // dc:subject (repeatable)
  rights?: string; // dc:rights (verbatim copyright/licence line)
  date?: string; // dc:date (publication; ISO date or year)
  identifier?: string; // dc:identifier override (ISBN/UUID); defaults to book.id
  series?: string; // belongs-to-collection
  seriesIndex?: number; // group-position within the series
  accessibility?: BookAccessibility; // EPUB Accessibility 1.1 (schema.org a11y) metadata

  // Release lifecycle (ADR-008). Absent or "release" → no watermark.
  status?: "draft" | "release"; // "draft" watermarks the artifact
  version?: string; // e.g. "1.0"
  edition?: string; // e.g. "First Edition"
  releaseDate?: string; // ISO date, set on release
  watermark?: string; // explicit override text; else "DRAFT" when status === "draft"
  revisionHistory?: { version: string; date: string; notes?: string }[];
}

// EPUB Accessibility 1.1 metadata (schema.org accessibility vocabulary →
// schema:* meta in the OPF). Most values are auto-derived from the actual
// content on compile (math → MathML, diagrams/images → a visual access mode);
// every field here is an OVERRIDE/extension. We deliberately do not auto-assert
// WCAG conformance or `alternativeText` — `conformsTo`/`certifiedBy` are for
// titles that have actually been audited. See docs/PROFESSIONAL_PUBLISHING.md.
export interface BookAccessibility {
  summary?: string; // schema:accessibilitySummary (human-readable)
  accessModes?: string[]; // schema:accessMode — replaces the auto-detected set
  accessModeSufficient?: string[]; // schema:accessModeSufficient — each entry is one comma-joined sufficient set
  features?: string[]; // schema:accessibilityFeature — merged with the auto-detected features
  hazards?: string[]; // schema:accessibilityHazard — defaults to ["none"]
  conformsTo?: string; // dcterms:conformsTo — a conformance-profile URL; set ONLY when truly conformant
  certifiedBy?: string; // a11y:certifiedBy — who vouches for the conformance claim
}

export interface Book {
  id: string;
  title: string;
  toc: StructuredTOC;
  createdAt: string;
  updatedAt: string;
  content?: Record<string, GeneratedTopic>;
  metadata?: BookMetadata;
}
