import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { LessonOutput } from "@/types/lesson";
import { colors } from "@/constants/theme";

// react-native-webview is native-only. Import lazily so the web bundle never
// tries to resolve it (it has no web entry point and would throw at load time).
const WebView = Platform.OS !== "web"
  ? require("react-native-webview").default
  : null;

interface LessonRendererProps {
  lesson: LessonOutput;
}

export function buildHtml(lesson: LessonOutput): string {
  // Embed the lesson as JSON — avoids all HTML-escape issues with raw markdown.
  const lessonJson = JSON.stringify(lesson);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
    --success: #22c55e;
    --warning: ${colors.warning};
    color-scheme: dark;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, "Helvetica Neue", sans-serif;
    font-size: 16px;
    line-height: 1.65;
    padding: 16px;
  }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 6px; color: var(--text); }
  h2 { font-size: 1.2rem; font-weight: 700; margin: 20px 0 8px; color: var(--text); }
  h3 { font-size: 1rem; font-weight: 600; margin: 16px 0 6px; color: var(--text2); }
  h4, h5, h6 { font-size: 0.95rem; font-weight: 600; margin: 12px 0 4px; }
  p  { margin: 10px 0; }
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
  hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .synopsis {
    color: var(--text2); font-size: 0.95em;
    margin: 12px 0 20px; padding: 12px;
    background: var(--surface); border-radius: 8px;
    border-left: 3px solid var(--primary);
  }
  .objectives, .takeaways, .further {
    background: var(--surface); border-radius: 8px;
    padding: 12px 16px; margin: 16px 0;
  }
  .objectives { border-left: 3px solid var(--primary); }
  .takeaways  { border-left: 3px solid var(--success); }
  .further    { border-left: 3px solid var(--muted); }
  .objectives h3 { color: var(--primary); margin-bottom: 8px; }
  .takeaways h3  { color: var(--success);  margin-bottom: 8px; }
  .further h3    { color: var(--muted);   margin-bottom: 8px; }
  .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
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
  var lesson = ${lessonJson};

  // Custom marked renderer — Mermaid fences become divs before KaTeX runs.
  var renderer = new marked.Renderer();
  renderer.code = function (code, lang) {
    if (lang === 'mermaid') return '<div class="mermaid">' + code + '</div>';
    return '<pre><code>' + code + '</code></pre>';
  };

  function renderMd(text) {
    return marked.parse(text || '', { renderer: renderer });
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function li(items) {
    return items.map(function (x) { return '<li>' + escHtml(x) + '</li>'; }).join('');
  }

  var html = '';
  html += '<h1>' + escHtml(lesson.topic) + '</h1>';
  html += '<p class="synopsis">' + escHtml(lesson.synopsis) + '</p>';

  html += '<div class="objectives"><h3>Learning objectives</h3><ul>' + li(lesson.learning_objectives) + '</ul></div>';

  lesson.sections.forEach(function (s) {
    html += '<hr class="section-divider">';
    html += '<h2>' + escHtml(s.heading) + '</h2>';
    html += renderMd(s.body_markdown);
  });

  html += '<hr class="section-divider">';
  html += '<div class="takeaways"><h3>Key takeaways</h3><ul>' + li(lesson.key_takeaways) + '</ul></div>';

  if (lesson.further_reading && lesson.further_reading.length) {
    html += '<div class="further"><h3>Further reading</h3><ul>' + li(lesson.further_reading) + '</ul></div>';
  }

  document.getElementById('root').innerHTML = html;

  // KaTeX auto-render — skip .mermaid divs so diagram syntax isn't mistaken for math.
  renderMathInElement(document.body, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$',  right: '$',  display: false },
    ],
    ignoredClasses: ['mermaid'],
    throwOnError: false,
  });

  // Mermaid after KaTeX so the DOM is stable.
  mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
})();
</script>
</body>
</html>`;
}

function LessonRendererWeb({ lesson }: LessonRendererProps) {
  const html = useMemo(() => buildHtml(lesson), [lesson]);
  const urlRef = useRef<string | null>(null);

  const src = useMemo(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const blob = new Blob([html], { type: "text/html" });
    urlRef.current = URL.createObjectURL(blob);
    return urlRef.current;
  }, [html]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* @ts-expect-error — iframe is a valid web element; RN types don't know it */}
      <iframe
        src={src}
        style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
        title="Lesson content"
      />
    </View>
  );
}

function LessonRendererNative({ lesson }: LessonRendererProps) {
  const html = useMemo(() => buildHtml(lesson), [lesson]);
  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        originWhitelist={["*"]}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        allowsInlineMediaPlayback={false}
        mixedContentMode="always"
        accessibilityLabel="Lesson content"
      />
    </View>
  );
}

export function LessonRenderer({ lesson }: LessonRendererProps) {
  if (Platform.OS === "web") return <LessonRendererWeb lesson={lesson} />;
  return <LessonRendererNative lesson={lesson} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
