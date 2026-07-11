// The native web reader's stylesheet — ported from `@/components/contentHtml`'s
// in-iframe <style> block (spec D5: "ports contentHtml.ts's stylesheet so the look
// matches or beats it").
//
// SCOPING MATTERS. The iframe isolated these rules; injected into the app document
// they would restyle the whole shell. Every selector is therefore nested under
// `.mentible-reader`, the class on the reader's container.
//
// Fonts are NOT loaded here. The iframe fetched Source Serif 4 from Google Fonts;
// the app already bundles its fonts via expo-font, so the reader inherits them.

import { colors } from "@/constants/theme";

export const READER_ROOT_CLASS = "mentible-reader";

export const READER_CSS = `
.${READER_ROOT_CLASS} {
  --bg: ${colors.background};
  --surface: ${colors.surface};
  --border: ${colors.border};
  --text: ${colors.text};
  --text2: ${colors.textSecondary};
  --muted: ${colors.textMuted};
  --primary: ${colors.primary};
  --success: ${colors.success};
  --error: ${colors.error};
  --warning: ${colors.warning};
  --sans: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
  --serif: 'Source Serif 4', "Noto Serif", Georgia, "Times New Roman", "Liberation Serif", serif;

  /* The iframe set this on :root. The reader div now owns its own scrollbar, so
     without it a light-themed browser paints a light scrollbar on a dark pane. */
  color-scheme: dark;

  background: var(--bg);
  color: var(--text);
  font-family: var(--serif);
  font-weight: 400;
  font-size: 16px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  padding: 20px 18px 40px;
  max-width: 42rem;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
}
.${READER_ROOT_CLASS} * { box-sizing: border-box; margin: 0; padding: 0; }
.${READER_ROOT_CLASS} h1, .${READER_ROOT_CLASS} h2, .${READER_ROOT_CLASS} h3,
.${READER_ROOT_CLASS} h4, .${READER_ROOT_CLASS} h5, .${READER_ROOT_CLASS} h6 {
  font-family: var(--sans); line-height: 1.3;
}
.${READER_ROOT_CLASS} h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 8px; color: var(--text); }
.${READER_ROOT_CLASS} h2 { font-size: 1.3rem; font-weight: 700; margin: 24px 0 8px; color: var(--text); }
.${READER_ROOT_CLASS} h3 { font-size: 1.1rem; font-weight: 600; margin: 18px 0 6px; color: var(--text2); }
.${READER_ROOT_CLASS} h4, .${READER_ROOT_CLASS} h5, .${READER_ROOT_CLASS} h6 { font-size: 1rem; font-weight: 600; margin: 14px 0 4px; }
.${READER_ROOT_CLASS} p { margin: 12px 0; }
.${READER_ROOT_CLASS} ul, .${READER_ROOT_CLASS} ol { padding-left: 22px; margin: 8px 0; }
.${READER_ROOT_CLASS} li { margin: 4px 0; }
.${READER_ROOT_CLASS} code {
  font-family: "Menlo", "Courier New", monospace; font-size: 0.88em;
  background: var(--surface); padding: 2px 5px; border-radius: 4px; color: #e2e8f0;
}
.${READER_ROOT_CLASS} pre {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; overflow-x: auto; margin: 12px 0;
}
.${READER_ROOT_CLASS} pre code { background: none; padding: 0; }
.${READER_ROOT_CLASS} blockquote {
  border-left: 3px solid var(--primary); padding: 8px 12px; margin: 12px 0;
  color: var(--text2); font-style: italic;
}
.${READER_ROOT_CLASS} table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9em; display: block; overflow-x: auto; }
.${READER_ROOT_CLASS} th { background: var(--surface); color: var(--text); font-weight: 600; padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
.${READER_ROOT_CLASS} td { padding: 7px 12px; border: 1px solid var(--border); color: var(--text2); }
.${READER_ROOT_CLASS} tr:nth-child(even) td { background: var(--surface); }
.${READER_ROOT_CLASS} a { color: var(--primary); }
.${READER_ROOT_CLASS} img { max-width: 100%; height: auto; display: block; margin: 12px auto; border-radius: 8px; }
.${READER_ROOT_CLASS} hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.${READER_ROOT_CLASS} .synopsis {
  color: var(--text2); font-size: 0.95em; margin: 12px 0 20px; padding: 12px;
  background: var(--surface); border-radius: 8px; border-left: 3px solid var(--primary);
}
.${READER_ROOT_CLASS} .objectives, .${READER_ROOT_CLASS} .takeaways, .${READER_ROOT_CLASS} .further,
.${READER_ROOT_CLASS} .mistakes, .${READER_ROOT_CLASS} .examples {
  background: var(--surface); border-radius: 8px; padding: 12px 16px; margin: 16px 0;
}
.${READER_ROOT_CLASS} .objectives { border-left: 3px solid var(--primary); }
.${READER_ROOT_CLASS} .takeaways { border-left: 3px solid var(--success); }
.${READER_ROOT_CLASS} .further { border-left: 3px solid var(--muted); }
.${READER_ROOT_CLASS} .mistakes { border-left: 3px solid var(--warning); }
.${READER_ROOT_CLASS} .objectives h3 { color: var(--primary); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .takeaways h3 { color: var(--success); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .further h3 { color: var(--muted); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .mistakes h3 { color: var(--warning); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .practice {
  background: var(--surface); border-left: 3px solid var(--warning);
  padding: 8px 12px; border-radius: 6px; margin: 10px 0;
}
.${READER_ROOT_CLASS} .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.${READER_ROOT_CLASS} .quiz-q {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px; margin: 12px 0;
}
.${READER_ROOT_CLASS} .quiz-options { list-style: none; padding-left: 0; margin: 8px 0; }
.${READER_ROOT_CLASS} .quiz-options li { padding: 2px 0; }
.${READER_ROOT_CLASS} .quiz-opt {
  display: block; width: 100%; text-align: left; padding: 6px 8px; margin: 0;
  font: inherit; color: var(--text2); background: transparent;
  border: 1px solid var(--border); border-radius: 6px; cursor: pointer;
}
.${READER_ROOT_CLASS} .quiz-opt:hover:not([disabled]) { background: var(--surface); }
.${READER_ROOT_CLASS} .quiz-opt[disabled] { cursor: default; }
.${READER_ROOT_CLASS} .quiz-opt.correct { color: var(--success); font-weight: 600; }
.${READER_ROOT_CLASS} .quiz-opt.correct::after { content: " ✓"; }
.${READER_ROOT_CLASS} .quiz-opt.incorrect { color: var(--error); }
.${READER_ROOT_CLASS} .quiz-opt.incorrect::after { content: " ✗"; }
.${READER_ROOT_CLASS} .quiz-answer { margin-top: 8px; color: var(--success); font-size: 0.9em; }
.${READER_ROOT_CLASS} .quiz-expl { color: var(--text2); font-size: 0.9em; }
.${READER_ROOT_CLASS} .difficulty { margin-top: 6px; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.${READER_ROOT_CLASS} .materials, .${READER_ROOT_CLASS} .safety, .${READER_ROOT_CLASS} .exp-questions { margin: 12px 0; }
.${READER_ROOT_CLASS} .safety { border-left: 3px solid var(--warning); padding-left: 12px; }
.${READER_ROOT_CLASS} .step { margin: 8px 0; }
.${READER_ROOT_CLASS} .step .obs { color: var(--text2); font-style: italic; font-size: 0.92em; }
.${READER_ROOT_CLASS} .mermaid { margin: 12px 0; }
.${READER_ROOT_CLASS} .mermaid svg { max-width: 100%; }
.${READER_ROOT_CLASS} .anim-svg {
  margin: 16px 0; text-align: center; background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; padding: 12px;
}
.${READER_ROOT_CLASS} .anim-svg svg { max-width: 100%; height: auto; }
.${READER_ROOT_CLASS} .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
`;
