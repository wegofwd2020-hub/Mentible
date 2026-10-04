// Re-export types used across API clients
export interface StructuredTocUnit {
  id: string;
  title: string;
  subtopics: unknown[];
  prerequisites: string[];
  source_ids?: string[];
}

export interface StructuredTocSubject {
  subject_label: string;
  units: StructuredTocUnit[];
}

export interface StructuredTocView {
  subjects: StructuredTocSubject[];
}

export interface ProjectView {
  id: string;
  title: string;
  topic: string | null;
  audience: string | null;
  goal: string | null;
  status: string;
  created_at: string | null;
  toc?: StructuredTocView;
  rights_attested_at: string | null;
  rights_holder: string | null;
}
