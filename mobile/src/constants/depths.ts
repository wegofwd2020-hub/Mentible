import type { Depth } from "@/types/generationParams";

export interface DepthOption {
  value: Depth;
  label: string;
  description: string;
}

// Mirrors the backend depth hints in prompt_builder.py (_DEPTH_HINTS).
export const DEPTHS: DepthOption[] = [
  { value: "quick", label: "Quick", description: "Concise overview" },
  { value: "standard", label: "Standard", description: "Balanced depth" },
  { value: "deep", label: "Deep", description: "Thorough, with examples" },
];

export const DEFAULT_DEPTH: Depth = "standard";
