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
}

export interface GenerateResponse {
  job_id: string;
  status: JobStatus;
}
