// The artifact stylesheet. Same class names as the in-app preview
// (mobile/src/components/contentHtml.ts) so structure is shared, but a LIGHT,
// neutral palette: an EPUB/print artifact should defer to the reading system and
// read well on paper, not carry the app's dark UI theme. Colours are concrete
// (no CSS variables / no theme injection) so the artifact is fully self-contained.

export const STYLESHEET = `
  * { box-sizing: border-box; }
  body {
    color: #1a1a1a;
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.6;
    margin: 0;
    padding: 1em;
  }
  h1 { font-size: 1.6em; font-weight: 700; margin: 0 0 0.3em; }
  h2 { font-size: 1.3em; font-weight: 700; margin: 1.2em 0 0.4em; }
  h3 { font-size: 1.1em; font-weight: 600; margin: 1em 0 0.3em; color: #333; }
  h4 { font-size: 1em; font-weight: 600; margin: 0.8em 0 0.2em; }
  p { margin: 0.6em 0; }
  ul, ol { padding-left: 1.4em; margin: 0.5em 0; }
  li { margin: 0.25em 0; }
  a { color: #1565c0; }
  code {
    font-family: "Courier New", monospace;
    font-size: 0.9em;
    background: #f2f2f2;
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  pre {
    background: #f6f6f6;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 0.8em;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid #1565c0;
    padding: 0.4em 0.9em;
    margin: 0.8em 0;
    color: #444;
    font-style: italic;
  }
  table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 0.95em; }
  th { background: #f2f2f2; font-weight: 600; padding: 0.5em 0.8em; border: 1px solid #ccc; text-align: left; }
  td { padding: 0.45em 0.8em; border: 1px solid #ccc; }
  hr.section-divider { border: none; border-top: 1px solid #ddd; margin: 1.4em 0; }
  .synopsis {
    color: #444; padding: 0.8em; margin: 0.8em 0 1.2em;
    background: #f6f8fa; border-left: 3px solid #1565c0; border-radius: 4px;
  }
  .objectives, .takeaways, .further, .mistakes, .examples, .materials, .safety {
    background: #f6f8fa; border-radius: 4px; padding: 0.8em 1em; margin: 1em 0;
  }
  .objectives { border-left: 3px solid #1565c0; }
  .takeaways  { border-left: 3px solid #2e7d32; }
  .further    { border-left: 3px solid #888; }
  .mistakes   { border-left: 3px solid #ef6c00; }
  .safety     { border-left: 3px solid #ef6c00; }
  .practice {
    background: #fff8e1; border-left: 3px solid #ef6c00;
    padding: 0.5em 0.8em; border-radius: 4px; margin: 0.7em 0;
  }
  .quiz-q {
    background: #fafafa; border: 1px solid #e0e0e0;
    border-radius: 6px; padding: 0.8em 1em; margin: 0.8em 0;
  }
  .quiz-options { list-style: none; padding-left: 0; margin: 0.5em 0; }
  .quiz-options li { padding: 0.2em 0; }
  .quiz-options li.correct { color: #2e7d32; font-weight: 600; }
  .quiz-answer { margin-top: 0.5em; color: #2e7d32; font-size: 0.92em; }
  .quiz-expl { color: #444; font-size: 0.92em; }
  .difficulty { margin-top: 0.4em; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
  .step .obs { color: #555; font-style: italic; font-size: 0.95em; }
  .diagram { margin: 0.9em 0; }
  .diagram--placeholder pre { white-space: pre-wrap; }
  .diagram figcaption { font-size: 0.8em; color: #888; margin-top: 0.3em; }
  math { font-size: 1.05em; }
`;
