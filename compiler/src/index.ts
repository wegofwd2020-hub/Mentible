// Public surface of the compile core (milestone 1). The EPUB packager and CLI
// (milestones 2–3) build on these; the heavy Mermaid renderer (milestone 4)
// plugs in via the DiagramRenderer seam.
export * from "./types";
export { renderMarkdown } from "./markdown";
export {
  renderLesson,
  renderTutorial,
  renderQuizzes,
  renderExperiment,
  renderTopicBody,
} from "./renderCore";
export { type DiagramRenderer, PassthroughDiagramRenderer } from "./diagrams";
export { STYLESHEET } from "./css";
export { escapeHtml } from "./html";
export { xhtmlDocument } from "./xhtml";
export { compileEpub, EmptyBookError, type CompileOptions } from "./epub";
