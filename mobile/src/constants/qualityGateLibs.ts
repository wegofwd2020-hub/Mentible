// The third-party libraries behind Mentible's quality gates — the tools that
// validate, sanitize, render, and export a project's content. Surfaced on the
// About page to credit them and pin the versions the gates run at.
//
// CURATED, hand-maintained. The gates run server-side (backend + the Node
// compiler), so the mobile app can't read these versions at runtime — update
// this list when the backend `requirements.txt` / `compiler/package.json`
// versions change. Sourced 2026-08-17.

export interface QualityGateLib {
  name: string;
  version: string; // display version; "—" when it's a runtime-only dep with no pinned version here
  role: string;
}

export const QUALITY_GATE_LIBS: readonly QualityGateLib[] = [
  { name: "wegofwd-llm", version: "0.2.0", role: "Content-trust manifest + LLM schema conformance" },
  { name: "pydantic", version: "2.x", role: "Schema validation" },
  { name: "anthropic (SDK)", version: "0.28.0", role: "Grounding + generation LLM calls" },
  { name: "DOMPurify", version: "3.4", role: "Content sanitization" },
  { name: "KaTeX", version: "0.17", role: "Math rendering" },
  { name: "Mermaid", version: "10.9", role: "Diagram rendering" },
  { name: "marked", version: "18", role: "Markdown parsing" },
  { name: "docx", version: "9.7", role: "Word export" },
  { name: "Vivliostyle", version: "—", role: "PDF typesetting (runtime)" },
];
