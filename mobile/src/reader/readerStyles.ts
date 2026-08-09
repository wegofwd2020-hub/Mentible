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
//
// THEME-REACTIVE (Studio P3 T1): the stylesheet used to be a static string built
// from the retired `colors` (indigo "study") palette. It is now a function of the
// ACTIVE palette (`readerCss(palette)`), so switching themes (e.g. to the light
// "studio-light" palette) re-themes the reader instead of staying pinned to a
// hardcoded dark scheme. `readerVars` also derives `--eq-filter` from whether the
// palette's background is dark — a light theme must NOT invert equation PNGs
// (they're already black-on-white, which is correct on a light/paper background).

import type { Palette } from "@/constants/theme";

export const READER_ROOT_CLASS = "mentible-reader";

// Relative luminance (WCAG-style, sRGB-without-gamma-correction approximation)
// of `palette.background`, parsed as `#rrggbb`. < 0.5 reads as "dark".
export function isDarkBackground(palette: Palette): boolean {
  const hex = palette.background.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5;
}

// The `--x: y;` custom-property lines for the given palette. NO wrapping
// selector — callers (readerCss below) inline this inside `.mentible-reader { }`.
export function readerVars(palette: Palette): string {
  const dark = isDarkBackground(palette);
  return `
  --bg: ${palette.background};
  --surface: ${palette.surface};
  --surfaceHigh: ${palette.surfaceHigh};
  --border: ${palette.border};
  --text: ${palette.text};
  --text2: ${palette.textSecondary};
  --muted: ${palette.textMuted};
  --primary: ${palette.primary};
  --success: ${palette.success};
  --error: ${palette.error};
  --warning: ${palette.warning};
  --sans: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
  --serif: 'Source Serif 4', "Noto Serif", Georgia, "Times New Roman", "Liberation Serif", serif;
  --display: 'PlayfairDisplay_500Medium', 'Playfair Display', Georgia, 'Times New Roman', serif;
  --reader-scheme: ${dark ? "dark" : "light"};
  --eq-filter: ${dark ? "invert(1)" : "none"};`;
}

// The full scoped stylesheet for the given palette.
export function readerCss(palette: Palette): string {
  return `
.${READER_ROOT_CLASS} {${readerVars(palette)}

  /* The iframe set color-scheme on :root. The reader div now owns its own
     scrollbar, so without it a light-themed browser paints a mismatched
     scrollbar. Now theme-reactive via --reader-scheme instead of a hardcoded
     "dark". */
  color-scheme: var(--reader-scheme);
  /* Each Playfair face below is loaded as its own single-weight @font-face
     (e.g. PlayfairDisplay_500Medium has no bold variant). Real h1-h6 tags
     carry a UA-stylesheet font-weight:bold by default, and with
     font-synthesis on (the default) the browser fakes a bold face from the
     single loaded weight — an ugly faux-bold, not real Playfair. Belt-and-
     suspenders: turn off synthesis here, AND set an explicit weight matching
     the loaded face on every heading rule below (see applyGlobalFont.ts for
     the native-side version of this same trap). */
  font-synthesis: none;

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
  font-family: var(--display); line-height: 1.3;
  /* Explicit — matches the loaded PlayfairDisplay_500Medium face. Without this,
     the UA's default bold h1-h6 weight would trigger faux-bold synthesis. */
  font-weight: 500;
}
.${READER_ROOT_CLASS} h1 { font-size: 1.6rem; margin: 0 0 8px; color: var(--text); }
.${READER_ROOT_CLASS} h2 { font-size: 1.3rem; margin: 24px 0 8px; color: var(--text); }
.${READER_ROOT_CLASS} h3 { font-size: 1.1rem; margin: 18px 0 6px; color: var(--text2); }
.${READER_ROOT_CLASS} h4, .${READER_ROOT_CLASS} h5, .${READER_ROOT_CLASS} h6 { font-size: 1rem; margin: 14px 0 4px; }
.${READER_ROOT_CLASS} p { margin: 12px 0; }
.${READER_ROOT_CLASS} ul, .${READER_ROOT_CLASS} ol { padding-left: 22px; margin: 8px 0; }
.${READER_ROOT_CLASS} li { margin: 4px 0; }
.${READER_ROOT_CLASS} code {
  font-family: "Menlo", "Courier New", monospace; font-size: 0.88em;
  background: var(--surface); padding: 2px 5px; border-radius: 4px; color: var(--text2);
}
.${READER_ROOT_CLASS} pre {
  font-family: "Menlo", "Courier New", monospace; font-size: 0.88em;
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
/* Inline equation/symbol images. LaTeX→EPUB books (e.g. Think Bayes) ship
   inline math as small PNGs *inside* the prose. The rule above forces every
   <img> to block + auto-margin, which rips a 72×21 "x/100" onto its own
   centered line so it reads as a giant display equation. An image flowing
   inside a paragraph stays inline and scales to the running text; standalone
   figures live in <figure>/<div>, not <p>, so they keep the block treatment. */
.${READER_ROOT_CLASS} p img {
  display: inline; vertical-align: middle;
  margin: 0 1px; max-height: 1.2em; width: auto; border-radius: 0;
  /* Equation PNGs are black-on-white. On a DARK theme, --eq-filter is invert(1),
     which turns them white-on-black, then mix-blend-mode: screen makes the (now
     black) background show the page through it — so the white equation box
     disappears and only the white glyphs remain. On a LIGHT theme, --eq-filter
     is "none": the PNG's own black-on-white rendering is already correct, so it
     is left untouched (screen is a no-op combined with an unfiltered image atop
     a light background). */
  filter: var(--eq-filter); mix-blend-mode: screen;
}
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
}
