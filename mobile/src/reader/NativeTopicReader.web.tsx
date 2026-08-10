// The native web reader (spec D1–D7): a book topic rendered into the app's own
// DOM instead of a sandboxed iframe. This is what buys whole-page text selection,
// browser find-in-page, real semantic headings, and the app's bundled fonts.
//
// Security: there is no iframe boundary here, so `renderTopicToSafeHtml` (which
// ends in a DOMPurify pass) IS the boundary. Never inject anything into this
// subtree that has not been through it.

import React, { useEffect, useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import "katex/dist/katex.min.css";
import type { GeneratedTopic } from "@/types/book";
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import { readerCss, READER_ROOT_CLASS } from "@/reader/readerStyles";
import { enhanceReaderNode } from "@/reader/enhance";
import { useTheme } from "@/theme";

// The content div is isolated in a React.memo so it re-renders ONLY when the
// html string changes. KaTeX and (lazily) Mermaid mutate this subtree OUT OF
// BAND after mount (Mermaid swaps the `.mermaid` source for an <svg>). React
// does not know about those mutations, so if this element re-rendered on an
// unrelated parent update (theme, scroll-induced layout, approve/withdraw
// state) React could re-apply `dangerouslySetInnerHTML` and wipe the rendered
// SVG back to the escaped source — the "diagram renders then reverts to raw
// code" bug. Freezing re-renders on a stable html keeps the rendered diagram.
const ReaderBody = React.memo(function ReaderBody({
  html,
  inline,
}: {
  html: string;
  inline?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // `ref.current` is null under react-test-renderer, so this guard also makes
  // the component test-safe.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return enhanceReaderNode(node);
  }, [html]);
  return (
    <div
      ref={ref}
      className={inline ? `${READER_ROOT_CLASS} inline` : READER_ROOT_CLASS}
      // SAFE: `html` is the output of renderTopicToSafeHtml → sanitizeFragment.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export function NativeTopicReader({
  topic,
  figures,
  inline,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
  inline?: boolean;
}) {
  const theme = useTheme();
  const html = useMemo(() => renderTopicToSafeHtml(topic, figures), [topic, figures]);

  return (
    <View
      style={[inline ? styles.inlineContainer : styles.container, { backgroundColor: theme.background }]}
    >
      <style data-mentible-reader="">{readerCss(theme)}</style>
      <ReaderBody html={html} inline={inline} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inlineContainer: {},
});
