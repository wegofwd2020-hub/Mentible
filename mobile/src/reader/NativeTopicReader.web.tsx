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
import { READER_CSS, READER_ROOT_CLASS } from "@/reader/readerStyles";
import { enhanceReaderNode } from "@/reader/enhance";
import { colors } from "@/constants/theme";

export function NativeTopicReader({ topic }: { topic: GeneratedTopic }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderTopicToSafeHtml(topic), [topic]);

  // KaTeX and (lazily) Mermaid, over the mounted node. `ref.current` is null under
  // react-test-renderer, so this guard also makes the component test-safe.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return enhanceReaderNode(node);
  }, [html]);

  return (
    <View style={styles.container}>
      <style data-mentible-reader="">{READER_CSS}</style>
      <div
        ref={ref}
        className={READER_ROOT_CLASS}
        // SAFE: `html` is the output of renderTopicToSafeHtml → sanitizeFragment.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
