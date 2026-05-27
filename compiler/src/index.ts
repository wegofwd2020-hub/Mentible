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
export {
  type DiagramRenderer,
  PassthroughDiagramRenderer,
  CollectingDiagramRenderer,
  PrerenderedDiagramRenderer,
} from "./diagrams";
export {
  type MermaidRenderer,
  PuppeteerMermaidRenderer,
  collectMermaidSources,
  prerenderDiagrams,
  extractSvg,
} from "./mermaid";
export { STYLESHEET } from "./css";
export { escapeHtml } from "./html";
export { xhtmlDocument } from "./xhtml";
export { compileEpub, EmptyBookError, type CompileOptions } from "./epub";
export { buildPdfHtml, orderedChapters, type PdfChapter } from "./pdf";
export {
  compilePdf,
  VivliostyleRenderer,
  type PdfRenderer,
  type CompilePdfOptions,
} from "./pdfRender";
