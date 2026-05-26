import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";
import { buildHtml, buildTopicHtml } from "@/components/contentHtml";
import { colors } from "@/constants/theme";

// Re-export the pure builders so existing importers keep working
// (`@/components/LessonRenderer` was their home before the contentHtml split).
export { buildHtml, buildTopicHtml };

// react-native-webview is native-only. Import lazily so the web bundle never
// tries to resolve it (it has no web entry point and would throw at load time).
const WebView = Platform.OS !== "web" ? require("react-native-webview").default : null;

// ── Shared WebView/iframe host ────────────────────────────────────────────────
// Both renderers differ only in the HTML they build; the platform plumbing
// (blob iframe on web, react-native-webview on native) is identical.

interface HtmlViewProps {
  html: string;
  label: string;
}

function HtmlViewWeb({ html, label }: HtmlViewProps) {
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
        title={label}
      />
    </View>
  );
}

function HtmlViewNative({ html, label }: HtmlViewProps) {
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

function HtmlView(props: HtmlViewProps) {
  if (Platform.OS === "web") return <HtmlViewWeb {...props} />;
  return <HtmlViewNative {...props} />;
}

// ── Public renderers ──────────────────────────────────────────────────────────

/** Renders a single lesson (single-lesson generate path). */
export function LessonRenderer({ lesson }: { lesson: LessonOutput }) {
  const html = useMemo(() => buildHtml(lesson), [lesson]);
  return <HtmlView html={html} label="Lesson content" />;
}

/** Renders a full book topic — lesson plus any tutorial / quiz sets / experiment. */
export function TopicRenderer({ topic }: { topic: GeneratedTopic }) {
  const html = useMemo(() => buildTopicHtml(topic), [topic]);
  return <HtmlView html={html} label="Topic content" />;
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
