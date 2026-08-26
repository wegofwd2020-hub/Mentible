// The reusable scoped-generation template (SCOPE.md §mental-model) shared by
// every generation path — the book generate-all loop and per-topic regeneration.
// Stored per-book (Book.generationParams) and seeded from a global default
// (settingsStore). language/format are fixed at MVP but kept here so the template
// is the single source of truth. provider/model pin the LLM per book (one model
// per book for voice/format consistency — see docs/multi-provider-wiring-phase3).

export type Depth = "quick" | "standard" | "deep";

// Diagram register (the "diagram direction" of a publication). Steers what KIND
// of diagrams generation produces — from high-level branded infographics for a
// non-technical/overview book to precise flowchart/sequence/state/architecture
// diagrams for a technical/reference one. Mirrors the backend literal in
// generate/schemas.py + the guidance blocks in prompt_builder.py. See the
// diagram-register gallery and ADR-007 (generation directives live in the
// template params).
export type DiagramRegister = "conceptual" | "balanced" | "technical";

export interface GenerationParams {
  level: string; // one of constants/levels LEVELS
  depth: Depth;
  pages: number; // whole-book page target; 0 = no limit ("as much as possible")
  language: string; // "en" at MVP
  format: "lesson"; // D13 — only lesson at MVP
  diagramRegister: DiagramRegister; // diagram direction (conceptual ↔ technical)
  // LLM the book is pinned to (BYOK). Mirrors the backend provider_id; a known
  // provider id from pipeline/providers/registry ("anthropic", "openai", …).
  provider: string;
  // Optional concrete model override; null = the provider's registry default.
  model: string | null;
}

export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  level: "student",
  depth: "standard",
  pages: 0,
  language: "en",
  format: "lesson",
  diagramRegister: "balanced",
  provider: "groq",
  model: null,
};
