import type { ProjectDetailView } from "@/api/trustClient";

export type PhaseKey = "capture" | "create" | "validate" | "share";
export const PHASE_ORDER: PhaseKey[] = ["capture", "create", "validate", "share"];
export const PHASE_LABELS: Record<PhaseKey, string> = {
  capture: "Sources",
  create: "Drafts",
  validate: "Feedback",
  share: "Publish",
};

export interface ProjectPhase {
  phases: { key: PhaseKey; done: boolean }[];
  currentIdx: number;
  currentKey: PhaseKey | "create_artifact";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function deriveProjectPhase(detail: ProjectDetailView, isOwner: boolean): ProjectPhase {
  const captured = (detail.inputs?.length ?? 0) > 0;
  const hasArtifact = detail.artifacts.length > 0;
  const anyVersion = detail.artifacts.some((a) => a.versions.length > 0);
  const allValidated = hasArtifact && detail.artifacts.every((a) => a.versions.some((v) => v.is_validated));
  const done: Record<PhaseKey, boolean> = { capture: captured, create: anyVersion, validate: allValidated, share: false };
  const phases = PHASE_ORDER.map((key) => ({ key, done: done[key] }));
  const currentIdx = phases.findIndex((p) => !p.done);
  const base = phases[currentIdx].key;
  const currentKey = base === "create" && !hasArtifact ? "create_artifact" : base;
  return { phases, currentIdx, currentKey };
}
