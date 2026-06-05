// Pure HTML-document builders for the content reader. No React/RN imports, so
// the markup logic is unit-testable in plain jest.
//
// The reader is a self-contained HTML document rendered in a WebView (native)
// or iframe (web): markdown via `marked`, maths via KaTeX, diagrams via Mermaid
// — all CDN-loaded and run in-page (RN has no DOM, so rendering can't happen in
// the bundle). `buildHtml` renders a single lesson (the original single-lesson
// path); `buildTopicHtml` renders a full multi-format topic (lesson + optional
// tutorial + quiz sets + experiment) for the book reader.

import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";
import { colors } from "@/constants/theme";

// In-page render helpers + per-type builders. Inlined as a string because the
// WebView sandbox can't import bundle modules. Uses only single quotes so it
// nests cleanly inside the template literal below.
const RENDER_HELPERS_JS = `
  var renderer = new marked.Renderer();
  renderer.code = function (code, lang) {
    if (lang === 'mermaid') return '<div class="mermaid">' + code + '</div>';
    return '<pre><code>' + code + '</code></pre>';
  };
  function renderMd(text) { return marked.parse(text || '', { renderer: renderer }); }
  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function li(items) {
    return (items || []).map(function (x) { return '<li>' + escHtml(x) + '</li>'; }).join('');
  }
  function normHeading(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\\s+/g, ' '); }
  // The model often repeats the section heading as a leading "## Heading" line
  // in body_markdown; since we already emit the heading, drop that duplicate.
  function stripDupHeading(body, heading) {
    var text = String(body == null ? '' : body);
    var m = text.match(/^\\s*#{1,6}[ \\t]+(.+?)[ \\t]*#*[ \\t]*(?:\\r?\\n|$)/);
    if (m && normHeading(m[1]) === normHeading(heading)) return text.slice(m[0].length);
    return text;
  }

  function renderLesson(lesson) {
    var h = '';
    h += '<h1>' + escHtml(lesson.topic) + '</h1>';
    h += '<p class="synopsis">' + escHtml(lesson.synopsis) + '</p>';
    h += '<div class="objectives"><h3>Learning objectives</h3><ul>' + li(lesson.learning_objectives) + '</ul></div>';
    (lesson.sections || []).forEach(function (s) {
      h += '<hr class="section-divider">';
      h += '<h2>' + escHtml(s.heading) + '</h2>';
      h += renderMd(stripDupHeading(s.body_markdown, s.heading));
    });
    h += '<hr class="section-divider">';
    h += '<div class="takeaways"><h3>Key takeaways</h3><ul>' + li(lesson.key_takeaways) + '</ul></div>';
    if (lesson.further_reading && lesson.further_reading.length) {
      h += '<div class="further"><h3>Further reading</h3><ul>' + li(lesson.further_reading) + '</ul></div>';
    }
    return h;
  }

  function renderTutorial(tut) {
    var h = '<hr class="section-divider"><h2>' + escHtml(tut.title || 'Tutorial') + '</h2>';
    (tut.sections || []).forEach(function (s) {
      h += '<h3>' + escHtml(s.title) + '</h3>';
      h += renderMd(s.content);
      if (s.examples && s.examples.length) {
        h += '<div class="examples"><h4>Examples</h4>';
        s.examples.forEach(function (ex) { h += renderMd(ex); });
        h += '</div>';
      }
      if (s.practice_question) {
        h += '<div class="practice"><b>Practice:</b> ' + escHtml(s.practice_question) + '</div>';
      }
    });
    if (tut.common_mistakes && tut.common_mistakes.length) {
      h += '<div class="mistakes"><h3>Common mistakes</h3><ul>' + li(tut.common_mistakes) + '</ul></div>';
    }
    return h;
  }

  function renderQuizzes(sets) {
    var h = '<hr class="section-divider"><h2>Quiz</h2>';
    sets.forEach(function (set) {
      if (sets.length > 1 && set.set_number != null) {
        h += '<h3>Set ' + escHtml(set.set_number) + '</h3>';
      }
      (set.questions || []).forEach(function (q, i) {
        h += '<div class="quiz-q">';
        h += '<div class="quiz-qtext">' + renderMd((i + 1) + '. ' + (q.question_text || '')) + '</div>';
        h += '<ul class="quiz-options">';
        (q.options || []).forEach(function (o) {
          var correct = o.option_id === q.correct_option;
          h += '<li class="' + (correct ? 'correct' : '') + '"><b>' + escHtml(o.option_id) + '.</b> '
            + escHtml(o.text) + (correct ? ' \\u2713' : '') + '</li>';
        });
        h += '</ul>';
        h += '<div class="quiz-answer"><b>Answer:</b> ' + escHtml(q.correct_option) + '</div>';
        if (q.explanation) h += '<div class="quiz-expl">' + renderMd(q.explanation) + '</div>';
        if (q.difficulty) h += '<div class="difficulty">' + escHtml(q.difficulty) + '</div>';
        h += '</div>';
      });
    });
    return h;
  }

  function renderExperiment(exp) {
    var h = '<hr class="section-divider"><h2>' + escHtml(exp.experiment_title || 'Experiment') + '</h2>';
    if (exp.materials && exp.materials.length) {
      h += '<div class="materials"><h3>Materials</h3><ul>' + li(exp.materials) + '</ul></div>';
    }
    if (exp.safety_notes && exp.safety_notes.length) {
      h += '<div class="safety"><h3>Safety</h3><ul>' + li(exp.safety_notes) + '</ul></div>';
    }
    if (exp.steps && exp.steps.length) {
      h += '<h3>Steps</h3><ol>';
      exp.steps.forEach(function (st) {
        h += '<li class="step">' + escHtml(st.instruction)
          + '<div class="obs">Expected: ' + escHtml(st.expected_observation) + '</div></li>';
      });
      h += '</ol>';
    }
    if (exp.questions && exp.questions.length) {
      h += '<div class="exp-questions"><h3>Questions</h3>';
      exp.questions.forEach(function (qa) {
        h += '<p><b>Q:</b> ' + escHtml(qa.question) + '<br><b>A:</b> ' + escHtml(qa.answer) + '</p>';
      });
      h += '</div>';
    }
    if (exp.conclusion_prompt) {
      h += '<div class="practice"><b>Conclusion:</b> ' + escHtml(exp.conclusion_prompt) + '</div>';
    }
    return h;
  }
`;

function htmlDocument(dataJson: string, bodyJs: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Source Serif 4 = a clean book serif loaded from the web; "Noto Serif" is
     the on-device fallback so body prose renders serif even offline / when the
     web font is unavailable (the generic serif keyword is not reliable on the
     Android WebView). -->
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"
  crossorigin="anonymous">
<style>
  :root {
    --bg: ${colors.background};
    --surface: ${colors.surface};
    --border: ${colors.border};
    --text: ${colors.text};
    --text2: ${colors.textSecondary};
    --muted: ${colors.textMuted};
    --primary: ${colors.primary};
    --success: ${colors.success};
    --warning: ${colors.warning};
    /* Match the EPUB/PDF artifact: serif body for prose, sans for headings/UI. */
    --sans: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
    --serif: 'Source Serif 4', "Noto Serif", Georgia, "Times New Roman", "Liberation Serif", serif;
    color-scheme: dark;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: var(--bg); }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--serif);
    font-weight: 400;
    font-size: 16px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
    padding: 20px 18px 40px;
    /* Cap the line length for a comfortable reading measure (esp. on tablets). */
    max-width: 42rem;
    margin: 0 auto;
  }
  h1, h2, h3, h4, h5, h6 { font-family: var(--sans); line-height: 1.3; }
  h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 8px; color: var(--text); }
  h2 { font-size: 1.3rem; font-weight: 700; margin: 24px 0 8px; color: var(--text); }
  h3 { font-size: 1.1rem; font-weight: 600; margin: 18px 0 6px; color: var(--text2); }
  h4, h5, h6 { font-size: 1rem; font-weight: 600; margin: 14px 0 4px; }
  p  { margin: 12px 0; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 4px 0; }
  code {
    font-family: "Menlo", "Courier New", monospace;
    font-size: 0.88em;
    background: var(--surface);
    padding: 2px 5px;
    border-radius: 4px;
    color: #e2e8f0;
  }
  pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    overflow-x: auto;
    margin: 12px 0;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid var(--primary);
    padding: 8px 12px;
    margin: 12px 0;
    color: var(--text2);
    font-style: italic;
  }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9em; display: block; overflow-x: auto; }
  th { background: var(--surface); color: var(--text); font-weight: 600; padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
  td { padding: 7px 12px; border: 1px solid var(--border); color: var(--text2); }
  tr:nth-child(even) td { background: var(--surface); }
  a { color: var(--primary); }
  img { max-width: 100%; height: auto; display: block; margin: 12px auto; border-radius: 8px; }
  hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .synopsis {
    color: var(--text2); font-size: 0.95em;
    margin: 12px 0 20px; padding: 12px;
    background: var(--surface); border-radius: 8px;
    border-left: 3px solid var(--primary);
  }
  .objectives, .takeaways, .further, .mistakes, .examples {
    background: var(--surface); border-radius: 8px;
    padding: 12px 16px; margin: 16px 0;
  }
  .objectives { border-left: 3px solid var(--primary); }
  .takeaways  { border-left: 3px solid var(--success); }
  .further    { border-left: 3px solid var(--muted); }
  .mistakes   { border-left: 3px solid var(--warning); }
  .objectives h3 { color: var(--primary); margin-bottom: 8px; }
  .takeaways h3  { color: var(--success);  margin-bottom: 8px; }
  .further h3    { color: var(--muted);   margin-bottom: 8px; }
  .mistakes h3   { color: var(--warning); margin-bottom: 8px; }
  .practice {
    background: var(--surface); border-left: 3px solid var(--warning);
    padding: 8px 12px; border-radius: 6px; margin: 10px 0;
  }
  .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .quiz-q {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 14px; margin: 12px 0;
  }
  .quiz-options { list-style: none; padding-left: 0; margin: 8px 0; }
  .quiz-options li { padding: 4px 0; color: var(--text2); }
  .quiz-options li.correct { color: var(--success); font-weight: 600; }
  .quiz-answer { margin-top: 8px; color: var(--success); font-size: 0.9em; }
  .quiz-expl { color: var(--text2); font-size: 0.9em; }
  .difficulty { margin-top: 6px; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .materials, .safety, .exp-questions { margin: 12px 0; }
  .safety { border-left: 3px solid var(--warning); padding-left: 12px; }
  .step { margin: 8px 0; }
  .step .obs { color: var(--text2); font-style: italic; font-size: 0.92em; }
  .mermaid { margin: 12px 0; }
  .mermaid svg { max-width: 100%; }
  .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
  .error-banner { background: #7f1d1d; border-radius: 8px; padding: 12px; color: #fca5a5; }
</style>
</head>
<body>
<div id="root">Loading…</div>

<script src="https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js" crossorigin="anonymous"></script>

<script>
(function () {
  var DATA = ${dataJson};
  ${RENDER_HELPERS_JS}

  var html = '';
  ${bodyJs}
  document.getElementById('root').innerHTML = html;

  renderMathInElement(document.body, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$',  right: '$',  display: false },
    ],
    ignoredClasses: ['mermaid'],
    throwOnError: false,
  });

  mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
})();
</script>
</body>
</html>`;
}

/** Single lesson — the original single-lesson reader path. */
export function buildHtml(lesson: LessonOutput): string {
  return htmlDocument(JSON.stringify(lesson), "html += renderLesson(DATA);");
}

/** Full multi-format topic — lesson plus any of tutorial / quiz sets / experiment. */
export function buildTopicHtml(topic: GeneratedTopic): string {
  return htmlDocument(
    JSON.stringify(topic),
    `html += renderLesson(DATA.lesson);
     if (DATA.tutorial) html += renderTutorial(DATA.tutorial);
     if (DATA.quizSets && DATA.quizSets.length) html += renderQuizzes(DATA.quizSets);
     if (DATA.experiment) html += renderExperiment(DATA.experiment);`,
  );
}
