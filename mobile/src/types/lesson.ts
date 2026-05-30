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

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  result?: LessonOutput;
  error?: string;
}

export interface GenerateRequest {
  request_id: string;
  topic: string;
  level: string;
  language: string;
  format: "lesson";
  api_key: string;
  depth?: "quick" | "standard" | "deep";
  // Target length in pages for this lesson's prose (excludes quizzes/answers).
  // 0 or omitted = no explicit target. For a book, the client divides the
  // whole-book page target across topics, so this is the per-lesson share.
  target_pages?: number;
}

export interface GenerateResponse {
  job_id: string;
  status: JobStatus;
}
