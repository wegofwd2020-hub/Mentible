import type { Book, GeneratedTopic, QuizSet } from "./types";
import { renderLesson, renderTutorial } from "./renderCore";
import { renderMarkdown } from "./markdown";
import { escapeHtml } from "./html";
import { PassthroughDiagramRenderer, type DiagramRenderer } from "./diagrams";
import { EmptyBookError } from "./epub";
import { SOURCE_SERIF_FONTFACE } from "./fonts";
import { buildCoverSvg, coverInputForBook } from "./cover";
import { colophonSection } from "./colophon";
import { numberFloats, type FloatRef } from "./floats";
import { watermarkText } from "./release";

// Build the single-document HTML for the print/PDF target — a *textbook
// compilation* (ADR-004 D5), distinct from the EPUB's per-topic layout:
//   1. title page
//   2. Table of Contents with page-number index (resolved by the CSS Paged
//      Media engine — Vivliostyle — via target-counter)
//   3. chapters: each topic's lesson + tutorial (NO inline quizzes)
//   4. a Quizzes section: every chapter's questions, grouped, no answers
//   5. an Answers section: the correct answer + explanation per question
//
// Rendered to PDF by pdfRender.ts (Vivliostyle). Diagrams are pre-rendered to
// SVG and embedded, same as the EPUB path.

export interface PdfChapter {
  id: string; // anchor target, e.g. "ch-001"
  number: number;
  title: string;
  topic: GeneratedTopic;
}

export function orderedChapters(book: Book): PdfChapter[] {
  const content = book.content ?? {};
  const out: PdfChapter[] = [];
  let n = 0;
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const topic = unit.id ? content[unit.id] : undefined;
      if (!topic) continue;
      n += 1;
      out.push({
        id: `ch-${String(n).padStart(3, "0")}`,
        number: n,
        title: topic.title || unit.title || `Topic ${n}`,
        topic,
      });
    }
  }
  return out;
}

// Quiz questions only — options as an A/B/C/D list, no correct-answer marking.
function renderQuestionsOnly(sets: readonly QuizSet[], diagrams: DiagramRenderer): string {
  let h = "";
  let n = 0;
  for (const set of sets) {
    for (const q of set.questions ?? []) {
      n += 1;
      h += '<div class="quiz-q">';
      h += `<div class="quiz-qtext">${renderMarkdown(`${n}. ${q.question_text || ""}`, diagrams)}</div>`;
      h += '<ol class="quiz-options" type="A">';
      for (const o of q.options ?? []) h += `<li>${escapeHtml(o.text)}</li>`;
      h += "</ol></div>";
    }
  }
  return h;
}

// Answer key — correct option + explanation, numbered to match the questions.
function renderAnswers(sets: readonly QuizSet[], diagrams: DiagramRenderer): string {
  let h = "";
  let n = 0;
  for (const set of sets) {
    for (const q of set.questions ?? []) {
      n += 1;
      h += `<div class="answer"><span class="answer-key"><b>${n}.</b> ${escapeHtml(q.correct_option)}</span>`;
      if (q.explanation) h += renderMarkdown(q.explanation, diagrams);
      h += "</div>";
    }
  }
  return h;
}

export interface PdfHtmlOptions {
  diagrams?: DiagramRenderer;
}

// Draft watermark (ADR-008) as an @page background image. A faint, rotated SVG
// set as the page background repeats on EVERY page in the paged-media engine
// (unlike position:fixed, which Vivliostyle paints only once), and sits behind
// the content so text stays legible. textLength keeps any phrase a consistent
// diagonal width.
function watermarkPageCss(text: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">` +
    `<text x="105" y="150" fill="#312a8c" fill-opacity="0.10" ` +
    `font-family="Helvetica,Arial,sans-serif" font-weight="bold" font-size="40" ` +
    `text-anchor="middle" textLength="150" lengthAdjust="spacingAndGlyphs" ` +
    `transform="rotate(-45 105 150)">${escapeHtml(text)}</text></svg>`;
  const uri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  return `@page { background-image: url("${uri}"); background-position: center center; background-repeat: no-repeat; }`;
}

export function buildPdfHtml(book: Book, opts: PdfHtmlOptions = {}): string {
  const diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  const chapters = orderedChapters(book);
  if (chapters.length === 0) throw new EmptyBookError();

  const withQuizzes = chapters.filter((c) => c.topic.quizSets && c.topic.quizSets.length);

  // ── Chapters: lesson + tutorial, with per-chapter figure/table numbering ────
  const figs: FloatRef[] = [];
  const tbls: FloatRef[] = [];
  const chaptersHtml = chapters
    .map((c) => {
      let body = renderLesson(c.topic.lesson, diagrams);
      if (c.topic.tutorial) body += renderTutorial(c.topic.tutorial, diagrams);
      const tableCaps = (c.topic.lesson as { table_captions?: string[] }).table_captions ?? [];
      body = numberFloats(body, c.number, figs, tbls, tableCaps);
      return `<section class="chapter" id="${c.id}">${body}</section>`;
    })
    .join("");

  // ── Table of contents, grouped by Part (page numbers via CSS target-counter) ─
  const byTopicId = new Map(chapters.map((c) => [c.topic.topicId, c]));
  let tocItems = "";
  for (const subject of book.toc.subjects) {
    const partChaps = subject.units
      .map((u) => (u.id ? byTopicId.get(u.id) : undefined))
      .filter((c): c is PdfChapter => Boolean(c));
    if (!partChaps.length) continue;
    tocItems += `<li class="toc-part">${escapeHtml(subject.subject_label)}</li>`;
    for (const c of partChaps) tocItems += `<li><a href="#${c.id}">${escapeHtml(c.title)}</a></li>`;
  }
  if (withQuizzes.length) {
    tocItems += '<li><a href="#quizzes">Quizzes</a></li><li><a href="#answers">Answers</a></li>';
  }
  const toc = `<nav class="toc" id="toc"><h1>Contents</h1><ol>${tocItems}</ol></nav>`;

  // ── List of Figures / List of Tables (front matter, after the TOC) ──────────
  const floatList = (cls: string, title: string, items: FloatRef[], kind: string): string =>
    items.length === 0
      ? ""
      : `<nav class="floatlist ${cls}"><h1>${title}</h1><ol>` +
        items
          .map(
            (x) =>
              `<li><a href="#${x.id}"><span class="fnum">${kind} ${x.num}</span> ${escapeHtml(x.caption)}</a></li>`,
          )
          .join("") +
        `</ol></nav>`;
  const lof = floatList("lof", "List of Figures", figs, "Figure");
  const lot = floatList("lot", "List of Tables", tbls, "Table");

  // ── Quizzes + Answers sections (grouped by chapter) ────────────────────────
  let quizzesHtml = "";
  let answersHtml = "";
  if (withQuizzes.length) {
    const byChapter = (render: (s: readonly QuizSet[], d: DiagramRenderer) => string) =>
      withQuizzes
        .map(
          (c) =>
            `<div class="quiz-chapter"><h2>Chapter ${c.number} — ${escapeHtml(c.title)}</h2>` +
            `${render(c.topic.quizSets ?? [], diagrams)}</div>`,
        )
        .join("");
    quizzesHtml = `<section class="quizzes" id="quizzes"><h1>Quizzes</h1>${byChapter(renderQuestionsOnly)}</section>`;
    answersHtml = `<section class="answers" id="answers"><h1>Answers</h1>${byChapter(renderAnswers)}</section>`;
  }

  // ── Glossary (back matter) — from book.metadata.glossary if present ─────────
  const glossary = (book.metadata as { glossary?: { term: string; definition: string }[] } | undefined)
    ?.glossary;
  const glossaryHtml =
    glossary && glossary.length
      ? `<section class="glossary" id="glossary"><h1>Glossary</h1><dl>` +
        glossary
          .map((g) => `<dt>${escapeHtml(g.term)}</dt><dd>${escapeHtml(g.definition)}</dd>`)
          .join("") +
        `</dl></section>`
      : "";

  const coverPage = `<section class="cover-page">${buildCoverSvg(coverInputForBook(book))}</section>`;
  const colophonPage = colophonSection(book);
  const lang = book.metadata?.language || "en";

  const wm = watermarkText(book.metadata);
  const watermarkCss = wm ? watermarkPageCss(wm) : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(book.title)}</title>
<style>${PDF_CSS}
${watermarkCss}</style>
</head>
<body>
${coverPage}
${colophonPage}
${toc}
${lof}
${lot}
${chaptersHtml}
${quizzesHtml}
${answersHtml}
${glossaryHtml}
</body>
</html>
`;
}

// CSS Paged Media stylesheet (resolved by Vivliostyle). The TOC page numbers
// come from target-counter(attr(href url), page).
const PDF_CSS = `
  ${SOURCE_SERIF_FONTFACE}
  @page {
    size: A4;
    margin: 24mm 22mm; /* more air (Anthropic-leaning); also spreads content toward the ~50pp target */
    background: #faf8f3; /* warm ivory ground */
    @bottom-center { content: counter(page); font-size: 9pt; color: #777; }
  }
  html {
    font-family: "Liberation Serif", Georgia, "Times New Roman", serif;
    font-size: 11pt;
    line-height: 1.62;
    color: #111;
    counter-reset: figure table;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    break-after: avoid;   /* keep a heading with the content that follows it */
    break-inside: avoid;
  }
  h1 { font-size: 1.6em; margin: 0 0 0.45em; }
  h2 { font-size: 1.25em; margin: 1.1em 0 0.35em; }
  h3 { font-size: 1.08em; margin: 0.9em 0 0.25em; color: #333; }
  p { margin: 0.55em 0; orphans: 2; widows: 2; }
  ul, ol { padding-left: 1.4em; }
  code { font-family: "Courier New", monospace; font-size: 0.9em; background: #f3f3f3; padding: 0 0.2em; }
  pre { background: #f6f6f6; border: 1px solid #ddd; padding: 0.6em; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 0.95em; counter-increment: table; break-inside: avoid; }
  th, td { border: 1px solid #d9d9e3; padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
  th { background: #312a8c; color: #fff; border-color: #312a8c; font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #f6f5fc; }
  caption {
    caption-side: top; text-align: left; font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    font-size: 0.85em; color: #555; margin-bottom: 0.3em;
  }
  .diagram { text-align: center; margin: 1.1em 0; break-inside: avoid; break-before: avoid; }
  .diagram svg { max-width: 100%; max-height: 84mm; width: auto; height: auto; }
  .diagram figcaption {
    font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    font-size: 0.85em; color: #555; margin-top: 0.3em;
  }
  .fnum { font-weight: 800; color: #312a8c; }

  /* Cover: its own page (no @page margin). The SVG (5:8) fills the full A4
     height edge-to-edge; its narrower width centres with slim side margins. */
  @page cover { margin: 0; }
  .cover-page { page: cover; break-after: page; text-align: center; background: #1e1b4b; }
  .cover-page svg { display: inline-block; height: 297mm; width: 185.6mm; }

  .colophon { break-after: page; text-align: center; }
  .colophon h1 { margin-top: 40mm; font-size: 1.4em; }
  .colophon .byline { font-size: 1.05em; color: #333; }
  .colophon hr { width: 30%; margin: 1.2em auto; border: none; border-top: 1px solid #ccc; }
  .colophon .identifier, .colophon .colophon-note { font-size: 0.85em; color: #777; }
  .colophon .draft-notice { color: #b91c1c; font-weight: 800; letter-spacing: 1px; }
  .colophon .edition { color: #16a34a; font-weight: 700; }
  .colophon .revisions { text-align: left; max-width: 64%; margin: 1.4em auto 0; }
  .colophon .revisions h2 { font-size: 1em; }
  .colophon .revisions ul { padding-left: 1.2em; font-size: 0.85em; color: #555; }

  nav.toc, nav.floatlist { break-after: page; }
  nav.toc ol, nav.floatlist ol { list-style: none; padding: 0; }
  nav.toc li, nav.floatlist li { margin: 0.35em 0; }
  nav.toc a, nav.floatlist a { text-decoration: none; color: #111; }
  nav.toc a::after, nav.floatlist a::after { content: leader('.') target-counter(attr(href url), page); color: #777; }
  .toc-part {
    font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px;
    color: #312a8c; font-size: 0.82em; margin: 1.1em 0 0.3em;
  }
  nav.floatlist .fnum { display: inline-block; min-width: 4.6em; }

  .glossary { break-before: page; }
  .glossary dl { margin: 0.5em 0; }
  .glossary dt {
    font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    font-weight: 700; color: #1e1b4b; margin-top: 0.7em; break-after: avoid;
  }
  .glossary dd { margin: 0.1em 0 0.4em 0; color: #333; break-inside: avoid; }

  .chapter, .quizzes, .answers { break-before: page; }
  .synopsis { font-style: italic; color: #444; margin: 0.6em 0 0.95em; }
  .objectives, .takeaways, .further, .mistakes, .examples { background: #f6f8fa; padding: 0.7em 0.95em; margin: 0.9em 0; break-inside: avoid; }
  .objectives ul, .takeaways ul, .further ul { margin: 0.3em 0; }
  li { margin: 0.22em 0; }
  /* Accent the lighter callouts; make Key Takeaways a branded panel. */
  .objectives { border-left: 3px solid #312a8c; }
  .further { border-left: 3px solid #16a34a; }
  .takeaways {
    background: #1e1b4b; color: #eceaf6; border-radius: 8px;
    padding: 0.8em 1.05em; margin: 0.9em 0; break-inside: avoid;
  }
  .takeaways h3 {
    color: #4ade80; text-transform: uppercase; letter-spacing: 0.08em;
    font-size: 0.82em; margin: 0 0 0.45em;
  }
  .takeaways ul { margin: 0.2em 0 0; }
  .takeaways strong { color: #fff; }
  .takeaways a { color: #9fd8ff; }
  .quiz-chapter { margin-bottom: 1.2em; }
  .quiz-q { margin: 0.6em 0; break-inside: avoid; }
  .quiz-qtext, .quiz-qtext p {
    font-family: "Nimbus Sans", "Helvetica Neue", "Liberation Sans", Arial, sans-serif; font-weight: 600;
  }
  .quiz-options { font-size: 0.9em; }
  .answer { margin: 0.4em 0; break-inside: avoid; }
  .answer-key { color: #1a6b1a; }
`;
