// GeneratedTopic → one DOMPurify-sanitized HTML fragment for the native web
// reader. Pure: no React, no I/O, no DOM mutation — unit-testable in plain jest
// (with the jsdom environment DOMPurify requires).
//
// Markup mirrors `@/components/contentHtml` so the iframe and native readers
// agree while the flag is in flight (spec D5). The two must be kept in step until
// the iframe is retired on web.
//
// Web-only. Exactly ONE sanitize pass, at the bottom of renderTopicToSafeHtml.

import type { GeneratedTopic, ExperimentOutput, QuizSet, TutorialOutput } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";
import { renderFiguresHtml } from "@/lib/figuresHtml";
import { sanitizeFragment } from "@/reader/sanitize";
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

/** Untrusted topic → sanitized HTML fragment, safe to inject into the app DOM. */
export function renderTopicToSafeHtml(
  topic: GeneratedTopic,
  dataUrls?: Map<string, string>,
): string {
  let html = renderLesson(topic.lesson);
  if (topic.tutorial) html += renderTutorial(topic.tutorial);
  if (topic.quizSets?.length) html += renderQuizzes(topic.quizSets);
  if (topic.experiment) html += renderExperiment(topic.experiment);
  // `renderFiguresHtml` has a JS twin (`renderFigures` in RENDER_HELPERS_JS,
  // @/components/contentHtml) for the WebView, which can't import bundle modules.
  // Keep both in step.
  if (topic.images?.length && dataUrls?.size) html += renderFiguresHtml(topic.images, dataUrls);
  return sanitizeFragment(html);
}
