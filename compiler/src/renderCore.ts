// The shared render core: a GeneratedTopic → HTML body fragment, assembled in the
// same structure (and class names) as the in-app preview
// (mobile/src/components/contentHtml.ts), so the compiled artifact and the
// preview render identically. Pure strings — no DOM, no React, no network.
//
// Maths are pre-rendered to MathML and Mermaid to a DiagramRenderer fragment, so
// the output needs zero runtime JS. Quizzes render as a STATIC answer key (the
// correct option is marked); the interactive layer is a later phase (ADR-004).

import type {
  ExperimentOutput,
  GeneratedTopic,
  LessonOutput,
  QuizSet,
  TutorialOutput,
} from "./types";
import { renderMarkdown } from "./markdown";
import { escapeHtml, li, stripDuplicateHeading } from "./html";
import type { DiagramRenderer } from "./diagrams";

const DIVIDER = '<hr class="section-divider"/>';

export function renderLesson(lesson: LessonOutput, diagrams: DiagramRenderer): string {
  let h = "";
  h += `<h1>${escapeHtml(lesson.topic)}</h1>`;
  h += `<p class="synopsis">${escapeHtml(lesson.synopsis)}</p>`;
  h += `<div class="objectives"><h3>Learning objectives</h3><ul>${li(lesson.learning_objectives)}</ul></div>`;
  for (const s of lesson.sections ?? []) {
    h += DIVIDER;
    h += `<h2>${escapeHtml(s.heading)}</h2>`;
    h += renderMarkdown(stripDuplicateHeading(s.body_markdown, s.heading), diagrams);
  }
  h += DIVIDER;
  h += `<div class="takeaways"><h3>Key takeaways</h3><ul>${li(lesson.key_takeaways)}</ul></div>`;
  if (lesson.further_reading && lesson.further_reading.length) {
    h += `<div class="further"><h3>Further reading</h3><ul>${li(lesson.further_reading)}</ul></div>`;
  }
  return h;
}

export function renderTutorial(tut: TutorialOutput, diagrams: DiagramRenderer): string {
  let h = `${DIVIDER}<h2>${escapeHtml(tut.title || "Tutorial")}</h2>`;
  for (const s of tut.sections ?? []) {
    h += `<h3>${escapeHtml(s.title)}</h3>`;
    h += renderMarkdown(s.content, diagrams);
    if (s.examples && s.examples.length) {
      h += '<div class="examples"><h4>Examples</h4>';
      for (const ex of s.examples) h += renderMarkdown(ex, diagrams);
      h += "</div>";
    }
    if (s.practice_question) {
      h += `<div class="practice"><b>Practice:</b> ${escapeHtml(s.practice_question)}</div>`;
    }
  }
  if (tut.common_mistakes && tut.common_mistakes.length) {
    h += `<div class="mistakes"><h3>Common mistakes</h3><ul>${li(tut.common_mistakes)}</ul></div>`;
  }
  return h;
}

export function renderQuizzes(sets: readonly QuizSet[], diagrams: DiagramRenderer): string {
  let h = `${DIVIDER}<h2>Quiz</h2>`;
  for (const set of sets) {
    if (sets.length > 1 && set.set_number != null) {
      h += `<h3>Set ${escapeHtml(set.set_number)}</h3>`;
    }
    (set.questions ?? []).forEach((q, i) => {
      h += '<div class="quiz-q">';
      h += `<div class="quiz-qtext">${renderMarkdown(`${i + 1}. ${q.question_text || ""}`, diagrams)}</div>`;
      h += '<ul class="quiz-options">';
      for (const o of q.options ?? []) {
        const correct = o.option_id === q.correct_option;
        h +=
          `<li class="${correct ? "correct" : ""}"><b>${escapeHtml(o.option_id)}.</b> ` +
          `${escapeHtml(o.text)}${correct ? " ✓" : ""}</li>`;
      }
      h += "</ul>";
      h += `<div class="quiz-answer"><b>Answer:</b> ${escapeHtml(q.correct_option)}</div>`;
      if (q.explanation) h += `<div class="quiz-expl">${renderMarkdown(q.explanation, diagrams)}</div>`;
      if (q.difficulty) h += `<div class="difficulty">${escapeHtml(q.difficulty)}</div>`;
      h += "</div>";
    });
  }
  return h;
}

export function renderExperiment(exp: ExperimentOutput): string {
  let h = `${DIVIDER}<h2>${escapeHtml(exp.experiment_title || "Experiment")}</h2>`;
  if (exp.materials && exp.materials.length) {
    h += `<div class="materials"><h3>Materials</h3><ul>${li(exp.materials)}</ul></div>`;
  }
  if (exp.safety_notes && exp.safety_notes.length) {
    h += `<div class="safety"><h3>Safety</h3><ul>${li(exp.safety_notes)}</ul></div>`;
  }
  if (exp.steps && exp.steps.length) {
    h += "<h3>Steps</h3><ol>";
    for (const st of exp.steps) {
      h +=
        `<li class="step">${escapeHtml(st.instruction)}` +
        `<div class="obs">Expected: ${escapeHtml(st.expected_observation)}</div></li>`;
    }
    h += "</ol>";
  }
  if (exp.questions && exp.questions.length) {
    h += '<div class="exp-questions"><h3>Questions</h3>';
    for (const qa of exp.questions) {
      h += `<p><b>Q:</b> ${escapeHtml(qa.question)}<br/><b>A:</b> ${escapeHtml(qa.answer)}</p>`;
    }
    h += "</div>";
  }
  if (exp.conclusion_prompt) {
    h += `<div class="practice"><b>Conclusion:</b> ${escapeHtml(exp.conclusion_prompt)}</div>`;
  }
  return h;
}

// Full topic body: lesson + any tutorial / quiz sets / experiment, in reading
// order. Mirrors buildTopicHtml's body in contentHtml.ts.
export function renderTopicBody(topic: GeneratedTopic, diagrams: DiagramRenderer): string {
  let h = renderLesson(topic.lesson, diagrams);
  if (topic.tutorial) h += renderTutorial(topic.tutorial, diagrams);
  if (topic.quizSets && topic.quizSets.length) h += renderQuizzes(topic.quizSets, diagrams);
  if (topic.experiment) h += renderExperiment(topic.experiment);
  return h;
}
