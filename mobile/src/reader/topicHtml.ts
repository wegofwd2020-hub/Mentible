// GeneratedTopic → one HTML fragment. THE renderer, for BOTH platforms.
//
// Pure: no React, no I/O, no DOM, no `marked` global — every dependency is a
// bundle import, so this runs on Hermes as happily as in a browser. That is the
// whole point:
//
//   - web    → `renderContent.ts` wraps this with the DOMPurify pass (DOM-only).
//   - native → `@/components/contentHtml` calls this in RN and ships the finished
//              HTML into the WebView.
//
// It replaces a ~130-line hand-duplicated copy of itself that used to live inside
// the WebView's `RENDER_HELPERS_JS` (renderMd/renderLesson/renderTutorial/
// renderQuizzes/renderExperiment/renderFigures — every one mirroring a function
// here). Two implementations of one renderer drifted, exactly as you would
// expect: the figure `alt` diverged between them (fixed in #324). There is now
// one. Do not reintroduce a second.
//
// It also fixes #325: the WebView needed `marked` from a CDN to render ANYTHING,
// so the reader was blank offline — in a product whose free tier is device-local
// and offline by design (ADR-028/029). Rendering here means the document carries
// finished HTML and needs no network for text.

import type { GeneratedTopic, ExperimentOutput, QuizSet, TutorialOutput } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";
import { renderFiguresHtml } from "@/lib/figuresHtml";
import { escapeHtml, li, md, stripDupHeading } from "@/reader/markdown";

const DIVIDER = '<hr class="section-divider">';

function renderLesson(lesson: LessonOutput): string {
  let h = `<h1>${escapeHtml(lesson.topic)}</h1>`;
  h += `<p class="synopsis">${escapeHtml(lesson.synopsis)}</p>`;
  h += `<div class="objectives"><h3>Learning objectives</h3><ul>${li(lesson.learning_objectives)}</ul></div>`;
  for (const s of lesson.sections ?? []) {
    h += DIVIDER;
    h += `<h2>${escapeHtml(s.heading)}</h2>`;
    h += md(stripDupHeading(s.body_markdown, s.heading));
  }
  h += DIVIDER;
  h += `<div class="takeaways"><h3>Key takeaways</h3><ul>${li(lesson.key_takeaways)}</ul></div>`;
  if (lesson.further_reading?.length) {
    h += `<div class="further"><h3>Further reading</h3><ul>${li(lesson.further_reading)}</ul></div>`;
  }
  return h;
}

function renderTutorial(tut: TutorialOutput): string {
  let h = `${DIVIDER}<h2>${escapeHtml(tut.title || "Tutorial")}</h2>`;
  for (const s of tut.sections ?? []) {
    h += `<h3>${escapeHtml(s.title)}</h3>`;
    h += md(s.content);
    if (s.examples?.length) {
      h += '<div class="examples"><h4>Examples</h4>';
      for (const ex of s.examples) h += md(ex);
      h += "</div>";
    }
    if (s.practice_question) {
      h += `<div class="practice"><b>Practice:</b> ${escapeHtml(s.practice_question)}</div>`;
    }
  }
  if (tut.common_mistakes?.length) {
    h += `<div class="mistakes"><h3>Common mistakes</h3><ul>${li(tut.common_mistakes)}</ul></div>`;
  }
  return h;
}

// Interactive reveal (spec 2026-07-11): options are buttons carrying their id and
// correctness; the answer/explanation live in a `hidden` block that quizReveal.ts
// (enhance pass) unhides once the learner picks. `data-answered=""` = unanswered.
function renderQuizzes(sets: QuizSet[]): string {
  let h = `${DIVIDER}<h2>Quiz</h2>`;
  for (const set of sets) {
    if (sets.length > 1 && set.set_number != null) {
      h += `<h3>Set ${escapeHtml(set.set_number)}</h3>`;
    }
    (set.questions ?? []).forEach((q, i) => {
      h += '<div class="quiz-q" data-answered="">';
      h += `<div class="quiz-qtext">${md(`${i + 1}. ${q.question_text || ""}`)}</div>`;
      h += '<ul class="quiz-options" role="group">';
      for (const o of q.options ?? []) {
        const correct = o.option_id === q.correct_option;
        h += `<li><button type="button" class="quiz-opt" data-oid="${escapeHtml(o.option_id)}" data-correct="${correct}">`;
        h += `<b>${escapeHtml(o.option_id)}.</b> ${escapeHtml(o.text)}</button></li>`;
      }
      h += "</ul>";
      h += '<div class="quiz-reveal" hidden>';
      h += `<div class="quiz-answer"><b>Answer:</b> ${escapeHtml(q.correct_option)}</div>`;
      if (q.explanation) h += `<div class="quiz-expl">${md(q.explanation)}</div>`;
      if (q.difficulty) h += `<div class="difficulty">${escapeHtml(q.difficulty)}</div>`;
      h += "</div></div>";
    });
  }
  return h;
}

function renderExperiment(exp: ExperimentOutput): string {
  let h = `${DIVIDER}<h2>${escapeHtml(exp.experiment_title || "Experiment")}</h2>`;
  if (exp.materials?.length) {
    h += `<div class="materials"><h3>Materials</h3><ul>${li(exp.materials)}</ul></div>`;
  }
  if (exp.safety_notes?.length) {
    h += `<div class="safety"><h3>Safety</h3><ul>${li(exp.safety_notes)}</ul></div>`;
  }
  if (exp.steps?.length) {
    h += "<h3>Steps</h3><ol>";
    for (const st of exp.steps) {
      h += `<li class="step">${escapeHtml(st.instruction)}`;
      h += `<div class="obs">Expected: ${escapeHtml(st.expected_observation)}</div></li>`;
    }
    h += "</ol>";
  }
  if (exp.questions?.length) {
    h += '<div class="exp-questions"><h3>Questions</h3>';
    for (const qa of exp.questions) {
      h += `<p><b>Q:</b> ${escapeHtml(qa.question)}<br><b>A:</b> ${escapeHtml(qa.answer)}</p>`;
    }
    h += "</div>";
  }
  if (exp.conclusion_prompt) {
    h += `<div class="practice"><b>Conclusion:</b> ${escapeHtml(exp.conclusion_prompt)}</div>`;
  }
  return h;
}

/**
 * The topic's HTML, UNSANITIZED. Callers own the boundary:
 *   - web: `renderTopicToSafeHtml` (renderContent.ts) sanitizes with DOMPurify.
 *   - native: the WebView is a separate context (no app secrets reachable) and has
 *     no DOM-side sanitizer today — the same posture as before this refactor. See
 *     #325 / the F1 spec (D-I4) for moving sanitization to the render boundary.
 */
export function renderTopicToHtml(
  topic: GeneratedTopic,
  dataUrls?: Map<string, string>,
): string {
  let html = renderLesson(topic.lesson);
  if (topic.tutorial) html += renderTutorial(topic.tutorial);
  if (topic.quizSets?.length) html += renderQuizzes(topic.quizSets);
  if (topic.experiment) html += renderExperiment(topic.experiment);
  if (topic.images?.length && dataUrls?.size) html += renderFiguresHtml(topic.images, dataUrls);
  return html;
}
