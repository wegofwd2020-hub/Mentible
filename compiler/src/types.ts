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

export interface TopicNode {
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

export interface Book {
  id: string;
  title: string;
  toc: StructuredTOC;
  createdAt: string;
  updatedAt: string;
  content?: Record<string, GeneratedTopic>;
}
