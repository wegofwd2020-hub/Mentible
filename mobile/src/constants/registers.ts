import type { DiagramRegister } from "@/types/generationParams";

export interface RegisterOption {
  value: DiagramRegister;
  label: string;
  description: string;
}

// Mirrors the backend register guidance in prompt_builder.py (_DIAGRAM_REGISTERS).
// The register sets the "diagram direction" for the whole book: conceptual
// infographics for an overview/non-technical audience ↔ precise technical
// diagrams (flowchart / sequence / state / architecture) for a reference one.
export const REGISTERS: RegisterOption[] = [
  { value: "conceptual", label: "Conceptual", description: "Big-idea infographics" },
  { value: "balanced", label: "Balanced", description: "Flowcharts + concepts" },
  { value: "technical", label: "Technical", description: "Precise system diagrams" },
];

export const DEFAULT_DIAGRAM_REGISTER: DiagramRegister = "balanced";
