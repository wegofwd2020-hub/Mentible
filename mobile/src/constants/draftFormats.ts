export interface DraftFormat {
  format: string;
  label: string;
  hint: string;
  role: "cornerstone" | "derivative";
}

export const DRAFT_FORMATS: DraftFormat[] = [
  { format: "linkedin", label: "LinkedIn post", hint: "180–260 words", role: "derivative" },
  { format: "x_thread", label: "X thread", hint: "5–8 tweets", role: "derivative" },
  { format: "reel", label: "Reel script", hint: "60 seconds", role: "derivative" },
  { format: "podcast", label: "Podcast cold-open", hint: "60–90 sec", role: "derivative" },
  { format: "essay", label: "Long-form essay", hint: "800–1200 words", role: "cornerstone" },
  { format: "book", label: "Chapter outline", hint: "book", role: "cornerstone" },
];
