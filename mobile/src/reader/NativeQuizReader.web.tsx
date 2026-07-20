// The web reader for a standalone chapter quiz (Open Shelves F2). Mirrors
// NativeTopicReader.web.tsx exactly — the quiz is OUR schema-validated
// generation output, not third-party prose, so it gets the topic/KaTeX render
// + sanitize path (renderChapterQuizToSafeHtml + enhanceReaderNode), unlike
// NativeChapterReader.web.tsx, which deliberately skips KaTeX because a
// stranger's EPUB text has no `$…$` contract with us.
//
// Security: there is no iframe boundary here, so `renderChapterQuizToSafeHtml`
// (which ends in a DOMPurify pass) IS the boundary. Never inject anything into
// this subtree that has not been through it.

import React, { useEffect, useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import "katex/dist/katex.min.css";
import type { QuizSet } from "@/types/book";
import { renderChapterQuizToSafeHtml } from "@/reader/renderContent";
import { READER_CSS, READER_ROOT_CLASS } from "@/reader/readerStyles";
import { enhanceReaderNode } from "@/reader/enhance";
import { colors } from "@/constants/theme";

export function NativeQuizReader({ quiz }: { quiz: QuizSet }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderChapterQuizToSafeHtml(quiz), [quiz]);

  // KaTeX + quiz click-to-reveal wiring, over the mounted node. `ref.current`
  // is null under react-test-renderer, so this guard also makes the component
  // test-safe (same as NativeTopicReader.web.tsx).
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
        // SAFE: `html` is the output of renderChapterQuizToSafeHtml → sanitizeFragment.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
