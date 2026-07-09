// SPIKE ROUTE (throwaway, web-only) — /reader-lab
//
// Renders one real book topic's lesson into the actual web DOM (no iframe), to
// judge whether native rendering reads/looks obviously better than the hardened
// sandboxed iframe reader. Compare side by side with the same topic at
// /book/topic/product-sense-and-ai/psai-ch01.
//
// Native-DOM wins this spike is meant to demonstrate: the app's own fonts/theme
// flow into the content, browser find-in-page and text selection work across the
// whole page, print works, and there's no CDN needed for the prose. Delete this
// route (and the reader-lab dir + spike deps) when the spike is judged.

import React, { useEffect, useMemo, useRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { colors, spacing, typography } from "@/constants/theme";
// Real content, straight from the shipped default library — no backend/auth needed.
import book from "../assets/library/books/product-sense-and-ai.book.json";

const TOPIC_ID = "psai-ch01";

// KaTeX from CDN, applied to the real node (the spike's math path). The prose
// pipeline (marked + DOMPurify) is npm; math rendering here is about proving it
// paints in the app DOM, not about the delivery mechanism.
const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
const KATEX_JS = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
const KATEX_AUTO = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed ${src}`));
    document.head.appendChild(s);
  });
}

function NativeReaderWeb() {
  const ref = useRef<HTMLDivElement | null>(null);

  // Sanitized HTML fragment (web-only module — lazy so native never bundles it).
  const html = useMemo(() => {
    const { renderLessonToSafeHtml } = require("@/reader-lab/nativeRender");
    const lesson = (book as { content: Record<string, { lesson: unknown }> }).content[TOPIC_ID]
      ?.lesson;
    return lesson ? renderLessonToSafeHtml(lesson) : "<p>topic not found</p>";
  }, []);

  useEffect(() => {
    if (!document.querySelector(`link[href="${KATEX_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = KATEX_CSS;
      document.head.appendChild(link);
    }
    let cancelled = false;
    void (async () => {
      await loadScript(KATEX_JS);
      await loadScript(KATEX_AUTO);
      if (cancelled || !ref.current) return;
      // @ts-expect-error CDN global
      window.renderMathInElement?.(ref.current, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className="reader-lab-content"
      // Sanitized by DOMPurify in renderLessonToSafeHtml. Native DOM, app fonts.
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        color: colors.text,
        fontFamily: typography.fontBody as string,
        lineHeight: 1.7,
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
      }}
    />
  );
}

export default function ReaderLab() {
  if (Platform.OS !== "web") {
    return (
      <View style={styles.native}>
        <Text style={styles.nativeText}>The reader-lab spike is web-only.</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.bar}>
        <Text style={styles.barText}>Native DOM reader (spike)</Text>
        <Link href={`/book/topic/product-sense-and-ai/${TOPIC_ID}`} style={styles.compare}>
          Compare: iframe reader →
        </Link>
      </View>
      <NativeReaderWeb />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  barText: { color: colors.textMuted, fontSize: typography.sizeSm },
  compare: { color: colors.brand, fontSize: typography.sizeSm },
  native: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  nativeText: { color: colors.text },
});
