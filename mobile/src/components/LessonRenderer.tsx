import React, { useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { GeneratedTopic } from "@/types/book";
import { buildTopicHtml } from "@/components/contentHtml";
import { colors } from "@/constants/theme";
import { NativeTopicReader } from "@/reader/NativeTopicReader";

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
 */
export function TopicRenderer({ topic }: { topic: GeneratedTopic }) {
  if (Platform.OS === "web") return <NativeTopicReader topic={topic} />;
  return <WebViewTopicRenderer topic={topic} />;
}

function WebViewTopicRenderer({ topic }: { topic: GeneratedTopic }) {
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
