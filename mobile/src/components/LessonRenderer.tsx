import React, { useMemo } from "react";
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
  // `srcDoc` (not a blob: URL) is deliberate. A blob: URL inherits this page's
  // origin, and a sandboxed frame has a *null* origin — so a sandboxed frame
  // cannot load a parent-origin blob and renders blank. `srcDoc` embeds the HTML
  // directly, which loads correctly under the sandbox. `useMemo` keeps the string
  // identity stable so the frame doesn't reload on unrelated re-renders.
  const srcDoc = useMemo(() => html, [html]);

  return (
    <View style={styles.container}>
      {/* @ts-ignore — <iframe> is web-only; whether RN/react-native-web types know it
          depends on what's in scope, so @ts-ignore (not @ts-expect-error) avoids both a
          type error and an "unused directive" error. This branch only renders on web. */}
      <iframe
        srcDoc={srcDoc}
        // SECURITY: without a sandbox this frame is SAME-ORIGIN with the app, so its
        // (model- or, via ADR-027 sharing, other-user-authored) content could read
        // localStorage — where the Supabase session and the BYOK LLM key live on web
        // — and exfiltrate them. `allow-scripts` keeps KaTeX/Mermaid/marked working;
        // withholding `allow-same-origin` gives the frame a null origin that cannot
        // reach the parent's storage. NEVER add allow-same-origin here: combined with
        // allow-scripts it lets the frame remove its own sandbox.
        sandbox="allow-scripts"
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
