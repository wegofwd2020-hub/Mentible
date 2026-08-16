import React, { useMemo, useState } from "react";
import { Platform, View } from "react-native";
import type { GeneratedTopic, ImportedChapter, QuizSet } from "@/types/book";
import { buildChapterHtml, buildChapterQuizHtml, buildTopicHtml } from "@/components/contentHtml";
import { type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
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
  /** Auto-height: the WebView sizes to its content and disables its own scroll
   * so it can flow inside a parent ScrollView (whole-book draft preview). A flex
   * WebView collapses to 0 with no definite height inside a ScrollView. */
  inline?: boolean;
}

// Injected once inline: post the document height on load, and again as async
// content (mermaid/KaTeX) finishes drawing, so the WebView grows to fit.
const AUTO_HEIGHT_JS = `(function () {
  function post() {
    var h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0);
    if (window.ReactNativeWebView && h > 0) window.ReactNativeWebView.postMessage(String(h));
  }
  post();
  window.addEventListener('resize', post);
  try { new MutationObserver(post).observe(document.body, { subtree: true, childList: true, attributes: true }); } catch (e) {}
  [150, 500, 1200, 2500].forEach(function (t) { setTimeout(post, t); });
})(); true;`;

function HtmlView({ html, label, inline }: HtmlViewProps) {
  const styles = useThemedStyles(makeStyles);
  const [height, setHeight] = useState(1);
  return (
    <View style={inline ? styles.inlineContainer : styles.container}>
      <WebView
        source={{ html }}
        style={inline ? [styles.inlineWebview, { height }] : styles.webview}
        javaScriptEnabled
        originWhitelist={["*"]}
        scrollEnabled={!inline}
        showsVerticalScrollIndicator={false}
        allowsInlineMediaPlayback={false}
        mixedContentMode="always"
        accessibilityLabel={label}
        injectedJavaScript={inline ? AUTO_HEIGHT_JS : undefined}
        onMessage={
          inline
            ? (e: { nativeEvent: { data: string } }) => {
                const h = Number(e.nativeEvent.data);
                if (Number.isFinite(h) && h > 0) setHeight(h);
              }
            : undefined
        }
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
  inline,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
  /** Opt-in: renders auto-height so the reader can flow inside a parent
   * ScrollView instead of self-scrolling. On web via NativeTopicReader /
   * readerStyles' `.inline` modifier; on native via the WebView auto-height host. */
  inline?: boolean;
}) {
  if (Platform.OS === "web") return <NativeTopicReader topic={topic} figures={figures} inline={inline} />;
  return <WebViewTopicRenderer topic={topic} figures={figures} inline={inline} />;
}

function WebViewTopicRenderer({
  topic,
  figures,
  inline,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
  inline?: boolean;
}) {
  const theme = useTheme();
  const html = useMemo(() => buildTopicHtml(topic, figures, theme), [topic, figures, theme]);
  return <HtmlView html={html} label="Topic content" inline={inline} />;
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
  const theme = useTheme();
  const html = useMemo(() => buildChapterHtml(chapter, theme), [chapter, theme]);
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
  const theme = useTheme();
  const html = useMemo(() => buildChapterQuizHtml(quiz, theme), [quiz, theme]);
  return <HtmlView html={html} label="Chapter quiz" />;
}

const makeStyles = (c: Palette) => ({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  webview: {
    flex: 1,
    backgroundColor: c.background,
  },
  // Inline (auto-height) host: no flex — the WebView's height is measured from
  // content and applied inline, so it flows inside a parent ScrollView.
  inlineContainer: {
    backgroundColor: c.background,
  },
  inlineWebview: {
    backgroundColor: c.background,
  },
});
