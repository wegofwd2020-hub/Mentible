import React, { useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { GeneratedTopic, ImportedChapter, QuizSet } from "@/types/book";
import { buildChapterHtml, buildChapterQuizHtml, buildTopicHtml } from "@/components/contentHtml";
import { colors } from "@/constants/theme";
import { NativeTopicReader } from "@/reader/NativeTopicReader";
import { NativeChapterReader } from "@/reader/NativeChapterReader";
import { NativeQuizReader } from "@/reader/NativeQuizReader";

// Re-export the pure builder so existing importers keep working
// (`@/components/LessonRenderer` was their home before the contentHtml split).
export { buildTopicHtml };

// react-native-webview is native-only. Import lazily so the web bundle never
// tries to resolve it (it has no web entry point and would throw at load time).
const WebView = Platform.OS !== "web" ? require("react-native-webview").default : null;

// ── Native WebView host ───────────────────────────────────────────────────────
// The native topic reader: renders built topic HTML in a react-native-webview.
// Web renders through NativeTopicReader instead (see TopicRenderer), so this host
// only ever mounts on native.

interface HtmlViewProps {
  html: string;
  label: string;
}

function HtmlView({ html, label }: HtmlViewProps) {
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
        accessibilityLabel={label}
      />
    </View>
  );
}

// ── Public renderers ──────────────────────────────────────────────────────────

/**
 * Renders a full book topic — lesson plus any tutorial / quiz sets / experiment.
 *
 * Web renders the native reader (real DOM: selection, find-in-page, semantic
 * headings, bundled fonts). Native renders the same content through a WebView.
 * The switch lives here (not at the two call sites) so the Studio topic screen and
 * the shared-draft reader can never drift apart.
 *
 * `NativeTopicReader` resolves to a throwing stub off-web, so the `Platform.OS`
 * guard is what keeps DOMPurify/marked/mermaid out of the native bundle (D3).
 *
 * `figures` (from `useTopicFigures`) is an optional id → data:URL map for any
 * author-attached images (media feature) — passed through to whichever
 * renderer is active so both surfaces can inline the same figures.
 */
export function TopicRenderer({
  topic,
  figures,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
}) {
  if (Platform.OS === "web") return <NativeTopicReader topic={topic} figures={figures} />;
  return <WebViewTopicRenderer topic={topic} figures={figures} />;
}

function WebViewTopicRenderer({
  topic,
  figures,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
}) {
  const html = useMemo(() => buildTopicHtml(topic, figures), [topic, figures]);
  return <HtmlView html={html} label="Topic content" />;
}

/**
 * Renders one chapter of an IMPORTED book. Same platform split as
 * `TopicRenderer`: web gets the real DOM (selection, find-in-page, bundled
 * fonts), native gets the same content through the WebView.
 */
export function ChapterRenderer({ chapter }: { chapter: ImportedChapter }) {
  if (Platform.OS === "web") return <NativeChapterReader chapter={chapter} />;
  return <WebViewChapterRenderer chapter={chapter} />;
}

function WebViewChapterRenderer({ chapter }: { chapter: ImportedChapter }) {
  const html = useMemo(() => buildChapterHtml(chapter), [chapter]);
  return <HtmlView html={html} label="Chapter content" />;
}

/**
 * Renders a standalone chapter quiz (Open Shelves F2 — "Make a quiz from this
 * chapter"). Same platform split as `TopicRenderer`/`ChapterRenderer`, and
 * deliberately goes through the TOPIC render path (KaTeX/GFM enhancement +
 * sanitize), not the chapter one: the quiz is OUR schema-validated content,
 * not third-party prose read from the chapter's own HTML.
 */
export function QuizRenderer({ quiz }: { quiz: QuizSet }) {
  if (Platform.OS === "web") return <NativeQuizReader quiz={quiz} />;
  return <WebViewQuizRenderer quiz={quiz} />;
}

function WebViewQuizRenderer({ quiz }: { quiz: QuizSet }) {
  const html = useMemo(() => buildChapterQuizHtml(quiz), [quiz]);
  return <HtmlView html={html} label="Chapter quiz" />;
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
