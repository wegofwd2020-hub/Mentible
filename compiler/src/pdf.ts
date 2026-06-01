import type { Book, GeneratedTopic, QuizSet } from "./types";
import { renderLesson, renderTutorial } from "./renderCore";
import { renderMarkdown } from "./markdown";
import { escapeHtml } from "./html";
import { PassthroughDiagramRenderer, type DiagramRenderer } from "./diagrams";
import { EmptyBookError } from "./epub";
import { SOURCE_SERIF_FONTFACE } from "./fonts";
import { buildCoverSvg, coverInputForBook } from "./cover";
import { colophonSection } from "./colophon";

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

export function buildPdfHtml(book: Book, opts: PdfHtmlOptions = {}): string {
  const diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  const chapters = orderedChapters(book);
  if (chapters.length === 0) throw new EmptyBookError();

  const withQuizzes = chapters.filter((c) => c.topic.quizSets && c.topic.quizSets.length);

  // ── Table of contents (page numbers added by CSS target-counter) ───────────
  const tocItems = chapters.map(
    (c) => `<li><a href="#${c.id}">${escapeHtml(c.title)}</a></li>`,
  );
  if (withQuizzes.length) {
    tocItems.push('<li><a href="#quizzes">Quizzes</a></li>');
    tocItems.push('<li><a href="#answers">Answers</a></li>');
  }
  const toc = `<nav class="toc" id="toc"><h1>Contents</h1><ol>${tocItems.join("")}</ol></nav>`;

  // ── Chapters: lesson + tutorial (renderLesson emits the <h1> chapter head) ──
  const chaptersHtml = chapters
    .map((c) => {
      let s = `<section class="chapter" id="${c.id}">`;
      s += renderLesson(c.topic.lesson, diagrams);
      if (c.topic.tutorial) s += renderTutorial(c.topic.tutorial, diagrams);
      return s + "</section>";
    })
    .join("");

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

  const coverPage = `<section class="cover-page">${buildCoverSvg(coverInputForBook(book))}</section>`;
  const colophonPage = colophonSection(book);
  const lang = book.metadata?.language || "en";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(book.title)}</title>
<style>${PDF_CSS}</style>
</head>
<body>
${coverPage}
${colophonPage}
${toc}
${chaptersHtml}
${quizzesHtml}
${answersHtml}
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
    margin: 20mm 18mm;
    @bottom-center { content: counter(page); font-size: 9pt; color: #777; }
  }
  html {
    font-family: "Source Serif 4", Georgia, "Times New Roman", "Liberation Serif", serif;
    line-height: 1.5;
    color: #111;
    counter-reset: figure table;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
  }
  h1 { font-size: 1.6em; margin: 0 0 0.4em; }
  h2 { font-size: 1.25em; margin: 1em 0 0.3em; }
  h3 { font-size: 1.08em; margin: 0.8em 0 0.2em; color: #333; }
  p { margin: 0.5em 0; }
  ul, ol { padding-left: 1.4em; }
  code { font-family: "Courier New", monospace; font-size: 0.9em; background: #f3f3f3; padding: 0 0.2em; }
  pre { background: #f6f6f6; border: 1px solid #ddd; padding: 0.6em; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 0.95em; counter-increment: table; }
  th, td { border: 1px solid #ccc; padding: 0.35em 0.6em; text-align: left; }
  caption {
    caption-side: top; text-align: left; font-family: "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    font-size: 0.85em; color: #555; margin-bottom: 0.3em;
  }
  caption::before { content: "Table " counter(table) ". "; font-weight: 700; }
  .diagram { counter-increment: figure; text-align: center; }
  .diagram svg { max-width: 100%; }
  .diagram figcaption {
    font-family: "Helvetica Neue", "Liberation Sans", Arial, sans-serif;
    font-size: 0.85em; color: #555; margin-top: 0.3em;
  }
  .diagram figcaption::before { content: "Figure " counter(figure) ". "; font-weight: 700; }

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

  nav.toc { break-after: page; }
  nav.toc ol { list-style: none; padding: 0; }
  nav.toc li { margin: 0.35em 0; }
  nav.toc a { text-decoration: none; color: #111; }
  nav.toc a::after { content: leader('.') target-counter(attr(href url), page); color: #777; }

  .chapter, .quizzes, .answers { break-before: page; }
  .synopsis { font-style: italic; color: #444; margin: 0.6em 0 1em; }
  .objectives, .takeaways, .further, .mistakes, .examples { background: #f6f8fa; padding: 0.6em 0.9em; margin: 0.8em 0; }
  .quiz-chapter { margin-bottom: 1.2em; }
  .quiz-q { margin: 0.6em 0; break-inside: avoid; }
  .quiz-qtext, .quiz-qtext p {
    font-family: "Helvetica Neue", "Liberation Sans", Arial, sans-serif; font-weight: 600;
  }
  .quiz-options { font-size: 0.9em; }
  .answer { margin: 0.4em 0; break-inside: avoid; }
  .answer-key { color: #1a6b1a; }
`;
